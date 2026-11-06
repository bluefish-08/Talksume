import type { Job, Profile } from "@talksume/core";
import { collectProfileSkills, creditFor, extractJdSkills, type JdSkill, scoreRole } from "./dimensions.ts";
import { classifyRole, type RoleFamily } from "./role.ts";
import { clamp01 } from "./text.ts";

/** 纯代码、不调模型的匹配解释：JD 里的词只来自原文，画像里的依据都能指回字段。 */

export type CoverageStatus = "have" | "partial" | "missing";

export interface KeywordItem {
  name: string;
  status: CoverageStatus;
  /** 画像里的依据；缺失时没有。 */
  source?: string;
  /** JD 原文片段。 */
  jd: string;
}

export type ExplainComponentKey = "skills" | "concepts" | "title" | "completeness";

export interface ExplainComponent {
  key: ExplainComponentKey;
  label: string;
  /** 0–100。 */
  score: number;
  /** 归一化后的权重，不可评估的项为 0，其余之和为 1。 */
  weight: number;
  applicable: boolean;
  note: string;
}

export interface MatchExplanation {
  /** 0–100，只由 components 加权得出。 */
  score: number;
  components: ExplainComponent[];
  required: KeywordItem[];
  bonus: KeywordItem[];
  /** JD 提到的方向/职责词（后端开发、前端开发等）。 */
  concepts: KeywordItem[];
  responsibilities: string[];
}

export interface JdKeywords {
  required: JdSkill[];
  bonus: JdSkill[];
  concepts: { name: string; jd: string }[];
  responsibilities: string[];
}

interface Concept {
  name: string;
  aliases: RegExp;
  family?: RoleFamily;
  /** 画像里持有这些技能时视为做过这个方向。 */
  impliedBy?: string[];
}

const CONCEPTS: Concept[] = [
  {
    name: "后端开发",
    aliases: /后端|服务端|后台开发|后台系统|java\s*后台|backend|back-end/i,
    family: "backend",
    impliedBy: ["Spring", "微服务", "分布式"],
  },
  {
    name: "前端开发",
    aliases: /前端|web\s*开发|h5|frontend|front-end/i,
    family: "frontend",
    impliedBy: ["React", "Vue", "HTML/CSS"],
  },
  {
    name: "客户端开发",
    aliases: /客户端|移动端|安卓|android\s*开发|ios\s*开发/i,
    family: "client",
    impliedBy: ["Android", "iOS", "Kotlin", "Swift"],
  },
  { name: "算法研发", aliases: /算法/, family: "algorithm", impliedBy: ["机器学习", "深度学习"] },
  {
    name: "数据分析",
    aliases: /数据分析|数据运营|商业分析/,
    family: "data",
    impliedBy: ["数据分析", "统计学"],
  },
  {
    name: "测试开发",
    aliases: /测试开发|软件测试|质量保障|\bqa\b/i,
    family: "test",
    impliedBy: ["自动化测试"],
  },
  { name: "产品设计", aliases: /产品经理|产品设计|需求分析/, family: "product", impliedBy: ["PRD", "Axure"] },
  {
    name: "内容运营",
    aliases: /内容运营|新媒体|用户运营|社群运营/,
    family: "ops",
    impliedBy: ["新媒体运营"],
  },
];

const SECTION_HEAD = /^[【[(（]?\s*(岗位职责|工作职责|工作内容|职位描述|你将负责)/;
const OTHER_HEAD = /^[【[(（]?\s*(任职要求|职位要求|岗位要求|我们希望你|加分项|福利|薪资)/;
const LIST_MARK = /^\s*(?:[-*•·]|\d+[.、)）]|[（(]\d+[)）])\s*/;
const RESPONSIBILITY_LIMIT = 4;
const LINE_LIMIT = 40;

function responsibilitiesOf(jdText: string): string[] {
  const lines: string[] = [];
  let inside = false;
  for (const raw of jdText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (SECTION_HEAD.test(line)) {
      inside = true;
      const rest = line.replace(/^[^:：]*[:：]/, "").trim();
      if (rest && rest !== line) lines.push(rest);
      continue;
    }
    if (OTHER_HEAD.test(line)) {
      inside = false;
      continue;
    }
    if (inside) lines.push(line.replace(LIST_MARK, ""));
  }
  return lines
    .filter((l) => l.length >= 4)
    .slice(0, RESPONSIBILITY_LIMIT)
    .map((l) => (l.length > LINE_LIMIT ? `${l.slice(0, LINE_LIMIT)}…` : l));
}

/** 必备/加分技能来自技能词典在 JD 原文里的命中，方向词来自同义词表，职责取自 JD 的职责段落原句。 */
export function extractJdKeywords(job: Pick<Job, "title" | "jdText">): JdKeywords {
  const skills = extractJdSkills(job);
  const text = `${job.title}\n${job.jdText}`;
  const concepts = CONCEPTS.flatMap((c) => {
    const hit = c.aliases.exec(text);
    if (!hit) return [];
    const global = new RegExp(c.aliases.source, `${c.aliases.flags.replace("g", "")}g`);
    const inTitle = new RegExp(c.aliases.source, c.aliases.flags).test(job.title);
    return inTitle || (text.match(global)?.length ?? 0) >= 2 ? [{ name: c.name, jd: hit[0] }] : [];
  });
  return {
    required: skills.filter((s) => s.weight >= 1),
    bonus: skills.filter((s) => s.weight < 1),
    concepts,
    responsibilities: responsibilitiesOf(job.jdText),
  };
}

const COVER = 0.7;

function statusOf(credit: number): CoverageStatus {
  if (credit >= COVER) return "have";
  return credit > 0 ? "partial" : "missing";
}

function profileText(profile: Profile): string {
  return [
    ...profile.intention.roles,
    ...profile.skills.map((s) => s.name),
    ...profile.experiences.flatMap((e) => [e.title, ...e.bullets]),
    ...profile.projects.flatMap((p) => [p.name, p.role ?? "", ...p.techStack, p.action ?? "", p.task ?? ""]),
    ...profile.education.map((e) => e.major ?? ""),
  ].join("\n");
}

function profileFamilies(profile: Profile): Set<RoleFamily> {
  const titles = [
    ...profile.intention.roles,
    ...profile.experiences.map((e) => e.title),
    ...profile.projects.map((p) => `${p.role ?? ""} ${p.name}`),
  ];
  return new Set(titles.map(classifyRole));
}

interface Unit {
  name: string;
  members: JdSkill[];
}

function groupUnits(skills: JdSkill[]): Unit[] {
  const units = new Map<string, JdSkill[]>();
  for (const s of skills) {
    const key = s.group ?? s.name;
    units.set(key, [...(units.get(key) ?? []), s]);
  }
  return [...units.values()].map((members) => ({
    name: members.length > 1 ? `${members.map((m) => m.name).join("/")} 之一` : (members[0]?.name ?? ""),
    members,
  }));
}

const COMPLETENESS_CHECKS: [string, (p: Profile) => boolean][] = [
  ["技能", (p) => p.skills.length > 0],
  ["项目或经历", (p) => p.projects.length + p.experiences.length > 0],
  [
    "经历描述",
    (p) =>
      p.experiences.some((e) => e.bullets.length > 0) ||
      p.projects.some((x) => x.action || x.result || x.task),
  ],
  ["学历专业", (p) => p.education.some((e) => e.school && e.major)],
  ["意向岗位", (p) => p.intention.roles.length > 0],
];

const BASE_WEIGHTS: Record<ExplainComponentKey, number> = {
  skills: 0.45,
  concepts: 0.15,
  title: 0.25,
  completeness: 0.15,
};

export function explainMatch(profile: Profile, job: Job): MatchExplanation {
  const jd = extractJdKeywords(job);
  const owned = collectProfileSkills(profile);

  const judge = (skills: JdSkill[]): { items: KeywordItem[]; got: number; total: number } => {
    let got = 0;
    let total = 0;
    const items = groupUnits(skills).map((unit) => {
      const weight = Math.max(...unit.members.map((m) => m.weight));
      let best: { skill: JdSkill; credit: number; source: string } | undefined;
      for (const m of unit.members) {
        const o = creditFor(m.name, owned);
        if (o && (!best || o.credit > best.credit)) best = { skill: m, credit: o.credit, source: o.source };
      }
      const credit = best?.credit ?? 0;
      total += weight;
      got += weight * credit;
      return {
        name: unit.name,
        status: statusOf(credit),
        ...(best && { source: best.source }),
        jd: (best?.skill ?? unit.members[0])?.snippet ?? "",
      } satisfies KeywordItem;
    });
    return { items, got, total };
  };
  const required = judge(jd.required);
  const bonus = judge(jd.bonus);
  const skillTotal = required.total + bonus.total;

  const text = profileText(profile);
  const families = profileFamilies(profile);
  const concepts: KeywordItem[] = jd.concepts.map((c) => {
    const def = CONCEPTS.find((x) => x.name === c.name);
    const byText = def?.aliases.exec(text);
    const bySkill = def?.impliedBy?.find((s) => (owned.get(s)?.credit ?? 0) >= COVER);
    const byFamily = def?.family && families.has(def.family);
    const source = byText
      ? `画像里写到「${byText[0]}」`
      : bySkill
        ? `画像技能「${bySkill}」`
        : byFamily
          ? "意向或经历方向一致"
          : undefined;
    return { name: c.name, status: source ? "have" : "missing", ...(source && { source }), jd: c.jd };
  });
  const conceptHave = concepts.filter((c) => c.status === "have").length;

  const role = scoreRole(profile, job);
  const checks = COMPLETENESS_CHECKS.map(([label, ok]) => ({ label, ok: ok(profile) }));
  const done = checks.filter((c) => c.ok).length;
  const lacking = checks.filter((c) => !c.ok).map((c) => c.label);

  const raw: Record<ExplainComponentKey, { score: number; applicable: boolean; note: string }> = {
    skills: {
      score: skillTotal > 0 ? clamp01((required.got + bonus.got) / skillTotal) : 0,
      applicable: skillTotal > 0,
      note:
        skillTotal > 0
          ? `必备 ${required.items.filter((i) => i.status !== "missing").length}/${required.items.length}，加分 ${bonus.items.filter((i) => i.status !== "missing").length}/${bonus.items.length}`
          : "JD 没有写明确的技能要求",
    },
    concepts: {
      score: concepts.length > 0 ? conceptHave / concepts.length : 0,
      applicable: concepts.length > 0,
      note: concepts.length > 0 ? `${conceptHave}/${concepts.length} 个方向词有对应` : "JD 没有点名方向词",
    },
    title: {
      score: role.score,
      applicable: role.applicable,
      note: role.evidence[0] ?? "",
    },
    completeness: {
      score: done / checks.length,
      applicable: true,
      note: lacking.length > 0 ? `还缺：${lacking.join("、")}` : "各部分都有内容",
    },
  };

  const keys = Object.keys(BASE_WEIGHTS) as ExplainComponentKey[];
  const live = keys.reduce((s, k) => s + (raw[k].applicable ? BASE_WEIGHTS[k] : 0), 0);
  const LABEL: Record<ExplainComponentKey, string> = {
    skills: "技能覆盖",
    concepts: "方向关键词",
    title: "岗位名契合",
    completeness: "简历完整度",
  };
  const components = keys.map((key): ExplainComponent => {
    const r = raw[key];
    return {
      key,
      label: LABEL[key],
      score: Math.round(r.score * 100),
      weight: r.applicable && live > 0 ? Math.round((BASE_WEIGHTS[key] / live) * 1000) / 1000 : 0,
      applicable: r.applicable,
      note: r.note,
    };
  });
  const score =
    live > 0
      ? keys.reduce((s, k) => s + (raw[k].applicable ? BASE_WEIGHTS[k] * raw[k].score : 0), 0) / live
      : 0;

  return {
    score: Math.round(score * 100),
    components,
    required: required.items,
    bonus: bonus.items,
    concepts,
    responsibilities: jd.responsibilities,
  };
}

export interface KeywordSummary {
  have: string[];
  missing: string[];
}

/** 推荐卡上的精简版：先列必备技能，再列加分和方向词，已有和缺失各取前几个。 */
export function summarizeKeywords(e: MatchExplanation, limit = 4): KeywordSummary {
  const all = [...e.required, ...e.concepts, ...e.bonus];
  const names = (pred: (i: KeywordItem) => boolean) =>
    all
      .filter(pred)
      .map((i) => i.name)
      .slice(0, limit);
  return {
    have: names((i) => i.status === "have"),
    missing: names((i) => i.status === "missing"),
  };
}
