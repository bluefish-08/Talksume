import type { Job, Profile } from "@talksume/core";
import { educationByRecency } from "./education.ts";
import { jobAllowsAnyCity, matchCity, profileCities, wantsAnyCity } from "./filters.ts";
import { classifyRole, ROLE_LABELS, type RoleFamily, roleRelatedness } from "./role.ts";
import { findSkills, normalizeSkillList, PARTIAL_COVERAGE, type SkillHit } from "./synonyms.ts";
import { clamp01, termFrequency, tokenize } from "./text.ts";
import type { DimensionScore } from "./types.ts";

export interface ScoreContext {
  /** 以岗位库为语料的逆文档频率，用来压低「负责」「优化」这类到处都有的词。 */
  idf: Map<string, number>;
}

const NA = (why: string): DimensionScore => ({ score: 0, applicable: false, evidence: [why] });

/* ---------- 技能 ---------- */

export interface JdSkill {
  name: string;
  weight: number;
  snippet: string;
  /** 同一句里「C/C++/Java/Go 等其中一门」这类任选其一的技能共用一个分组。 */
  group?: string;
}

const SECTION_HEADER =
  /^[【[(（]?\s*(岗位职责|工作职责|任职要求|职位要求|岗位要求|工作内容|职位描述|我们希望你)/;
const BONUS_MARK = /加分|优先|bonus|nice to have|更佳|佳者/i;
const ANY_OF = /其中一|任[一意]|之一|至少.{0,3}一|一[门种]|或者/;

export function extractJdSkills(job: Pick<Job, "title" | "jdText">): JdSkill[] {
  const found = new Map<string, JdSkill>();
  const add = (hit: SkillHit, weight: number, group?: string) => {
    const prev = found.get(hit.name);
    if (!prev) found.set(hit.name, { name: hit.name, weight, snippet: hit.snippet, ...(group && { group }) });
    else if (weight > prev.weight) found.set(hit.name, { ...prev, weight, snippet: hit.snippet });
  };

  for (const hit of findSkills(job.title)) add(hit, 1);

  let bonus = false;
  for (const [i, raw] of job.jdText.split("\n").entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (SECTION_HEADER.test(line)) bonus = false;
    if (BONUS_MARK.test(line) && line.length <= 12) bonus = true;
    const lineBonus = bonus || BONUS_MARK.test(line);
    const hits = findSkills(line);
    const langs = hits.filter((h) => h.category === "lang");
    const group = langs.length >= 2 && ANY_OF.test(line) ? `g${i}` : undefined;
    for (const hit of hits)
      add(hit, lineBonus ? 0.5 : 1, group && hit.category === "lang" ? group : undefined);
  }
  return [...found.values()];
}

export interface Owned {
  credit: number;
  source: string;
}

/** 计算机类专业默认学过的基础课，JD 点名时按半分计。 */
const CS_FUNDAMENTALS = ["操作系统", "数据结构与算法", "数据库", "网络协议"];

const LEVEL_CREDIT = { beginner: 0.6, familiar: 0.8, proficient: 1, expert: 1 } as const;
const EXPERIENCE_KIND = { internship: "实习", fulltime: "工作", parttime: "兼职" } as const;

export function collectProfileSkills(profile: Profile): Map<string, Owned> {
  const owned = new Map<string, Owned>();
  const put = (name: string, credit: number, source: string) => {
    const prev = owned.get(name);
    if (!prev || credit > prev.credit) owned.set(name, { credit, source });
  };

  for (const s of profile.skills) {
    for (const name of normalizeSkillList(s.name)) {
      put(name, s.level ? LEVEL_CREDIT[s.level] : 1, `画像技能「${s.name}」`);
    }
  }
  for (const p of profile.projects) {
    for (const t of p.techStack) {
      for (const name of normalizeSkillList(t)) put(name, 1, `项目「${p.name}」技术栈「${t}」`);
    }
    const text = [p.name, p.role, p.situation, p.task, p.action, p.result].filter(Boolean).join("\n");
    for (const hit of findSkills(text)) put(hit.name, 0.9, `项目「${p.name}」描述`);
  }
  for (const e of profile.experiences) {
    const text = [e.title, ...e.bullets].join("\n");
    for (const hit of findSkills(text)) {
      put(hit.name, 0.9, `${EXPERIENCE_KIND[e.kind]}「${e.company}·${e.title}」`);
    }
  }
  for (const edu of profile.education) {
    for (const hit of findSkills(edu.courses.join(" "))) put(hit.name, 0.5, `课程「${hit.snippet}」`);
    if (edu.major && majorField(edu.major) === "cs") {
      for (const name of CS_FUNDAMENTALS) put(name, 0.5, `专业「${edu.major}」核心课程`);
    }
  }
  return owned;
}

export function creditFor(name: string, owned: Map<string, Owned>): Owned | undefined {
  const own = owned.get(name);
  if (own && own.credit >= 0.7) return own;
  let best: Owned | undefined = own;
  for (const via of PARTIAL_COVERAGE[name] ?? []) {
    const o = owned.get(via);
    if (o && (!best || o.credit * 0.7 > best.credit)) {
      best = { credit: o.credit * 0.7, source: `相近技能「${via}」（${o.source}）` };
    }
  }
  return best;
}

export function scoreSkills(profile: Profile, job: Job): DimensionScore {
  const required = extractJdSkills(job);
  if (required.length === 0) return NA("JD 中没有识别到明确的技能要求");
  const owned = collectProfileSkills(profile);

  const units = new Map<string, JdSkill[]>();
  for (const s of required) {
    const key = s.group ?? s.name;
    units.set(key, [...(units.get(key) ?? []), s]);
  }

  let total = 0;
  let got = 0;
  const hitLines: string[] = [];
  const missLines: string[] = [];
  let hitCount = 0;
  for (const members of units.values()) {
    const weight = Math.max(...members.map((m) => m.weight));
    let best: { skill: JdSkill; owned: Owned } | undefined;
    for (const m of members) {
      const o = creditFor(m.name, owned);
      if (o && (!best || o.credit > best.owned.credit)) best = { skill: m, owned: o };
    }
    total += weight;
    got += weight * (best?.owned.credit ?? 0);
    const anyOf = members.length > 1 ? members.map((m) => m.name).join("/") : undefined;
    const first = members[0];
    if (best) {
      const name = anyOf ? `${best.skill.name}（JD 要求 ${anyOf} 之一）` : best.skill.name;
      hitLines.push(`命中 ${name}：${best.owned.source}；JD「${best.skill.snippet}」`);
      hitCount += 1;
    } else if (first) {
      const name = anyOf ? `${anyOf} 之一` : first.name;
      missLines.push(`缺少 ${name}：JD「${first.snippet}」${weight < 1 ? "（加分项）" : ""}`);
    }
  }
  const evidence = [...hitLines.slice(0, 5), ...missLines.slice(0, 3)];
  if (hitLines.length === 0) evidence.unshift("画像中没有出现 JD 要求的任何技能");
  else evidence.push(`满足 ${hitCount}/${units.size} 项技能要求`);
  return { score: clamp01(got / total), applicable: true, evidence };
}

/* ---------- 专业 ---------- */

type Field = "cs" | "math" | "ee" | "design" | "business" | "humanities" | "other";

const FIELD_RULES: [Field, RegExp][] = [
  [
    "cs",
    /计算机|软件|信息安全|网络工程|网络空间|物联网|人工智能|智能科学|数据科学|大数据|信息与计算|电子信息|信息工程|信息管理|数字媒体技术|智能/,
  ],
  ["math", /数学|统计|精算|运筹/],
  ["ee", /电子|通信|自动化|电气|控制|微电子|光电|机械|机电|仪器|测控|机器人/],
  ["design", /设计|美术|艺术|数字媒体|动画|视觉传达|绘画|雕塑/],
  ["business", /管理|经济|金融|会计|财务|市场营销|工商|电子商务|贸易|商务|人力资源|物流/],
  ["humanities", /中文|汉语言|新闻|传播|英语|外语|文学|广告|翻译|法学|法律|心理|社会|历史|哲学/],
];

const FIELD_LABEL: Record<Field, string> = {
  cs: "计算机/软件/AI 类",
  math: "数学/统计类",
  ee: "电子/通信/自动化类",
  design: "设计/艺术类",
  business: "经管类",
  humanities: "人文/传媒类",
  other: "其他",
};

const FIELD_ADJACENCY: Record<string, number> = {
  "cs|math": 0.65,
  "cs|ee": 0.65,
  "math|ee": 0.5,
  "math|business": 0.4,
  "business|humanities": 0.4,
  "design|humanities": 0.3,
  "design|cs": 0.25,
  "business|cs": 0.25,
};

function fieldAffinity(a: Field, b: Field): number {
  if (a === b) return 1;
  return FIELD_ADJACENCY[`${a}|${b}`] ?? FIELD_ADJACENCY[`${b}|${a}`] ?? 0.1;
}

export function majorField(major: string): Field {
  for (const [field, re] of FIELD_RULES) if (re.test(major)) return field;
  return "other";
}

const TECH_FAMILIES: RoleFamily[] = [
  "backend",
  "frontend",
  "client",
  "fullstack",
  "algorithm",
  "ai_app",
  "data",
  "test",
  "infra",
  "engine",
  "hardware",
  "tech_other",
];

const EXPECTED_FIELDS: Partial<Record<RoleFamily, Field[]>> = {
  design: ["design"],
  gamedesign: ["humanities", "design", "cs"],
};

/** 抓 JD 里带「专业」二字的句子，识别其中点名的专业大类。 */
export function jdMajorRequirement(
  jdText: string,
): { any: boolean; fields: Field[]; quote: string } | undefined {
  const text = jdText.replace(/专业(?:软件|能力|技能|知识|素养)/g, "");
  for (const sentence of text.split(/[\n。；;]/)) {
    if (!sentence.includes("专业")) continue;
    if (/专业不限|不限专业|各专业/.test(sentence))
      return { any: true, fields: [], quote: sentence.trim().slice(0, 40) };
    const fields = FIELD_RULES.filter(([, re]) => re.test(sentence)).map(([f]) => f);
    if (fields.length > 0) return { any: false, fields, quote: sentence.trim().slice(0, 40) };
  }
  return undefined;
}

export function scoreMajor(profile: Profile, job: Job): DimensionScore {
  const edu = educationByRecency(profile).find((e) => e.major);
  if (!edu?.major) return NA("画像中没有填写专业");
  const major = edu.major;
  const jobFamily = classifyRole(job.title);
  if (jobFamily === "other") return NA("无法判断岗位所属方向");
  const req = jdMajorRequirement(job.jdText);
  const mine = majorField(major);
  const who = `画像专业「${edu.school} ${major}」`;

  if (req?.any) {
    return { score: 0.7, applicable: true, evidence: [`${who}；JD「${req.quote}」专业不限`] };
  }
  if (req) {
    const hit = req.fields.find((f) => f === mine);
    const affinity = Math.max(...req.fields.map((f) => fieldAffinity(mine, f)));
    return {
      score: clamp01(hit ? 1 : affinity),
      applicable: true,
      evidence: [`${who}（${FIELD_LABEL[mine]}）${hit ? "符合" : "不完全符合"} JD「${req.quote}」`],
    };
  }
  const expected =
    EXPECTED_FIELDS[jobFamily] ??
    (TECH_FAMILIES.includes(jobFamily) ? (["cs", "math", "ee"] as Field[]) : undefined);
  if (!expected) {
    return {
      score: 0.6,
      applicable: true,
      evidence: [`${who}；${ROLE_LABELS[jobFamily]}类岗位对专业没有明确限制`],
    };
  }
  const hit = expected.includes(mine);
  return {
    score: clamp01(hit ? 0.85 : Math.max(...expected.map((f) => fieldAffinity(mine, f)))),
    applicable: true,
    evidence: [
      `${who}（${FIELD_LABEL[mine]}）${hit ? "对口" : "与"}${ROLE_LABELS[jobFamily]}岗位${hit ? "" : "关联度较低"}；JD 未写专业要求`,
    ],
  };
}

/* ---------- 项目/经历 ---------- */

interface ProfileDoc {
  label: string;
  tokens: Set<string>;
  family: RoleFamily;
  weight: number;
}

function profileDocs(profile: Profile): ProfileDoc[] {
  const docs: ProfileDoc[] = [];
  for (const e of profile.experiences) {
    const text = [e.company, e.title, ...e.bullets].join("\n");
    docs.push({
      label: `${EXPERIENCE_KIND[e.kind]}「${e.company}·${e.title}」`,
      tokens: new Set(tokenize(text)),
      family: classifyRole(e.title),
      weight: 1,
    });
  }
  for (const p of profile.projects) {
    const text = [p.name, p.role, ...p.techStack, p.situation, p.task, p.action, p.result]
      .filter(Boolean)
      .join("\n");
    docs.push({
      label: `项目「${p.name}」`,
      tokens: new Set(tokenize(text)),
      family: classifyRole(`${p.role ?? ""} ${p.name}`),
      weight: 0.8,
    });
  }
  return docs;
}

const KEY_TERMS = 25;
const KEYWORD_FULL_SCORE_AT = 0.2;

export function scoreExperience(profile: Profile, job: Job, ctx: ScoreContext): DimensionScore {
  const docs = profileDocs(profile);
  if (docs.length === 0) return NA("画像中还没有项目或实习经历");

  const tf = termFrequency(tokenize(`${job.title}\n${job.title}\n${job.jdText}`));
  const defaultIdf = Math.log(1 + 1);
  const weighted = [...tf.entries()]
    .map(([term, n]) => ({ term, w: (ctx.idf.get(term) ?? defaultIdf) * (1 + Math.log(n)) }))
    .sort((a, b) => b.w - a.w || a.term.localeCompare(b.term))
    .slice(0, KEY_TERMS);
  const totalW = weighted.reduce((s, t) => s + t.w, 0);

  let matchedW = 0;
  const bySource = new Map<string, string[]>();
  for (const { term, w } of weighted) {
    const owner = docs.find((d) => d.tokens.has(term));
    if (!owner) continue;
    matchedW += w;
    bySource.set(owner.label, [...(bySource.get(owner.label) ?? []), term]);
  }
  const keywordScore = totalW > 0 ? clamp01(matchedW / totalW / KEYWORD_FULL_SCORE_AT) : 0;

  const jobFamily = classifyRole(job.title);
  let familyScore = 0;
  let familyDoc: ProfileDoc | undefined;
  for (const d of docs) {
    const s = roleRelatedness(d.family, jobFamily) * d.weight;
    if (s > familyScore) {
      familyScore = s;
      familyDoc = d;
    }
  }

  const evidence: string[] = [];
  if (familyDoc && familyScore > 0) {
    evidence.push(
      `${familyDoc.label}属于${ROLE_LABELS[familyDoc.family]}方向，与岗位「${job.title}」（${ROLE_LABELS[jobFamily]}）${familyDoc.family === jobFamily ? "同类" : "相近"}`,
    );
  }
  for (const [label, terms] of [...bySource.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3)) {
    evidence.push(`${label}与 JD 共有关键词：${terms.slice(0, 6).join("、")}`);
  }
  if (evidence.length === 0) evidence.push("项目与实习经历和 JD 关键词几乎没有重合");
  return { score: clamp01(0.4 * keywordScore + 0.6 * familyScore), applicable: true, evidence };
}

/* ---------- 城市 ---------- */

export function scoreCity(profile: Profile, job: Job): DimensionScore {
  const preferred = profileCities(profile);
  const home = profile.basics.city?.trim().replace(/市$/, "");
  if (job.cities.length === 0) return NA("岗位没有标注城市");
  if (jobAllowsAnyCity(job.cities))
    return { score: 1, applicable: true, evidence: [`岗位支持远程/不限城市：${job.cities.join("、")}`] };
  if (preferred.length === 0) {
    if (!home) return NA("画像中没有填写意向城市");
    const hit = matchCity([home], job.cities);
    return hit
      ? {
          score: 0.8,
          applicable: true,
          evidence: [`画像所在地「${home}」在岗位城市 ${job.cities.join("、")} 之内`],
        }
      : {
          score: 0.3,
          applicable: true,
          evidence: [`画像所在地「${home}」不在岗位城市 ${job.cities.join("、")} 之内`],
        };
  }
  if (wantsAnyCity(preferred)) return { score: 1, applicable: true, evidence: ["意向城市不限"] };
  const hit = matchCity(preferred, job.cities);
  if (!hit)
    return {
      score: 0,
      applicable: true,
      evidence: [`意向城市 ${preferred.join("、")} 不在岗位城市 ${job.cities.join("、")} 之内`],
    };
  const score = hit.rank === 0 ? 1 : Math.max(0.7, 1 - 0.1 * hit.rank);
  return {
    score,
    applicable: true,
    evidence: [`意向城市第 ${hit.rank + 1} 位「${hit.city}」在岗位城市 ${job.cities.join("、")} 之内`],
  };
}

/* ---------- 意向岗位 ---------- */

export function scoreRole(profile: Profile, job: Job): DimensionScore {
  const roles = profile.intention.roles.map((r) => r.trim()).filter(Boolean);
  if (roles.length === 0) return NA("画像中没有填写意向岗位");
  const jobFamily = classifyRole(job.title);
  const jobTokens = new Set(tokenize(job.title));

  let best = { score: 0, evidence: `意向岗位「${roles[0]}」与「${job.title}」没有明显关联` };
  for (const role of roles) {
    const family = classifyRole(role);
    const related = roleRelatedness(family, jobFamily);
    const roleTokens = tokenize(role);
    const overlap = roleTokens.filter((t) => jobTokens.has(t));
    const textScore = roleTokens.length > 0 ? Math.min(0.5, overlap.length / roleTokens.length) : 0;
    const score = related >= 1 ? 1 : Math.max(related * 0.9, textScore);
    if (score > best.score) {
      const how =
        related >= 1
          ? `同属${ROLE_LABELS[jobFamily]}`
          : related > 0
            ? `${ROLE_LABELS[family]}与${ROLE_LABELS[jobFamily]}相近`
            : `仅有部分字面重合（${overlap.join("、")}）`;
      best = { score, evidence: `意向岗位「${role}」与岗位名「${job.title}」${how}` };
    }
  }
  return { score: clamp01(best.score), applicable: true, evidence: [best.evidence] };
}
