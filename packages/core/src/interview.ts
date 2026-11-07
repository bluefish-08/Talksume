import { polishItemKey, polishSourceHash, ungroundedTokens } from "./polish.ts";
import type { ResumeContent } from "./resume.ts";

export const INTERVIEW_KINDS = ["resume", "technical", "behavior", "motivation"] as const;
export type InterviewKind = (typeof INTERVIEW_KINDS)[number];

export const INTERVIEW_KIND_LABEL: Record<InterviewKind, string> = {
  resume: "简历深挖",
  technical: "技术基础",
  behavior: "行为面试",
  motivation: "岗位动机",
};

/** 面试官手里的那份简历取自哪里，优先级从高到低。 */
export const RESUME_SOURCES = ["application", "tailoring", "current"] as const;
export type ResumeSource = (typeof RESUME_SOURCES)[number];

export const RESUME_SOURCE_LABEL: Record<ResumeSource, string> = {
  application: "投递时的简历快照",
  tailoring: "针对这个岗位的定制版",
  current: "当前简历",
};

export interface AnswerPoint {
  text: string;
  /** 用户原话片段，答题要点只能来自这里。 */
  quote: string;
}

export type InterviewRisk =
  | { kind: "stronger_than_quote"; terms: string[]; note: string }
  | { kind: "no_source"; note: string };

export interface InterviewQuestion {
  id: string;
  kind: InterviewKind;
  question: string;
  /** 面试官想考察什么。 */
  focus: string;
  /** 怎么组织答案的步骤，只讲方法，不陈述用户事实。 */
  approach: string[];
  source: { bullet?: { heading: string; text: string }; jd?: string };
  answerPoints: AnswerPoint[];
  /** 材料不够时给用户的提醒，不替用户编答案。 */
  missing?: string;
  risks: InterviewRisk[];
}

export interface BulletRef {
  id: string;
  section: "experiences" | "projects" | "campus";
  itemKey: string;
  heading: string;
  subheading?: string;
  period?: string;
  techStack: string[];
  text: string;
  hash: string;
  factIds: string[];
}

const BULLET_SECTIONS = ["experiences", "projects", "campus"] as const;

/** 简历里每一条要点，面试官都可能追问；id 按出现顺序编号。 */
export function resumeBullets(resume: ResumeContent): BulletRef[] {
  let n = 0;
  return resume.sections.flatMap((section) => {
    const kind = BULLET_SECTIONS.find((k) => k === section.kind);
    if (!kind) return [];
    return section.items.flatMap((item) =>
      item.bullets
        .filter((b) => b.text.trim())
        .map((b) => ({
          id: `r${++n}`,
          section: kind,
          itemKey: polishItemKey(section.kind, item.heading),
          heading: item.heading,
          ...(item.subheading && { subheading: item.subheading }),
          ...(item.period && { period: item.period }),
          techStack: item.techStack ?? [],
          text: b.lead ? `${b.lead}：${b.text}` : b.text,
          hash: polishSourceHash(b.text),
          factIds: b.factIds,
        })),
    );
  });
}

const INTENSITY = [/显著|大幅|大大|极大|成倍/];
const WEAK_ROLE = /参与|协助|帮忙|帮着|帮老师|帮同学|配合|辅助|打下手|跟着|一起(?:做|写|开发)/;
const OWN_ROLE = /负责|主要(?:做|写|开发)|我做|我写|自己(?:做|写|开发|搭)|独立|主导|牵头/;

const clip = (text: string, max = 40) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** 简历措辞里原话支撑不了的地方：数字、技术词、拔高职责、程度词，以及原话说「参与」简历写「负责」。 */
export function strongerTerms(quotes: readonly string[], text: string): string[] {
  const source = quotes.join("\n");
  const terms = new Set(ungroundedTokens(source, text));
  for (const re of INTENSITY) {
    const hit = text.match(re);
    if (hit && !re.test(source)) terms.add(hit[0]);
  }
  if (/负责/.test(text) && !/负责/.test(source) && WEAK_ROLE.test(source) && !OWN_ROLE.test(source)) {
    terms.add("负责");
  }
  return [...terms];
}

/** 一条简历要点对应的风险：没有原话出处，或措辞比原话更重。 */
export function bulletRisks(text: string, quotes: readonly string[]): InterviewRisk[] {
  if (quotes.length === 0) {
    return [
      {
        kind: "no_source",
        note: "这条要点在画像里没有对应的原话出处（可能来自导入的简历或手动编辑），面试官追问时你要能自己讲清楚。",
      },
    ];
  }
  const terms = strongerTerms(quotes, text);
  if (terms.length === 0) return [];
  const said = quotes.find((q) => q.trim()) ?? "";
  return [
    {
      kind: "stronger_than_quote",
      terms,
      note: `简历写了「${terms.join("」「")}」，你原话里没有这个说法（你原话是「${clip(said)}」）。面试被问到时按实际情况说。`,
    },
  ];
}

const APPROACH_FIRST_PERSON =
  /(?:我|本人)(?:负责|主导|做过|参与|完成|开发|搭建|设计|实现|牵头|带领|独立|写过|写了|做了|带过|搞过)/;
const APPROACH_NUMBER = /\d+(?:\.\d+)?\s*[%％]?/g;
const APPROACH_TECH = [
  "微服务",
  "分布式",
  "高并发",
  "消息队列",
  "中间件",
  "云原生",
  "容器化",
  "机器学习",
  "深度学习",
  "推荐系统",
  "搜索引擎",
  "数据结构",
  "操作系统",
  "计算机网络",
  "全栈",
  "算法",
  "前端",
  "后端",
  "数据库",
  "缓存",
  "测试",
  "运维",
];
const APPROACH_NAMES = [
  // 常见城市和公司；没收录的中文专有名词仍靠提示词约束
  "北京",
  "上海",
  "广州",
  "深圳",
  "杭州",
  "南京",
  "成都",
  "武汉",
  "西安",
  "苏州",
  "厦门",
  "长沙",
  "合肥",
  "天津",
  "重庆",
  "腾讯",
  "阿里巴巴",
  "阿里",
  "字节跳动",
  "字节",
  "百度",
  "京东",
  "网易",
  "华为",
  "小米",
  "滴滴",
  "拼多多",
  "快手",
  "携程",
  "哔哩哔哩",
  "小红书",
  "蚂蚁",
  "美团",
  "中兴",
  "联想",
  "商汤",
  "旷视",
  "大疆",
];
const APPROACH_ORG = /公司|集团|科技|银行|大学|学院|研究院|工作室|实验室/g;
const GENERIC_ORG =
  /了解|熟悉|结合|目标|应聘|面试|岗位|行业|业务|公司|集团|团队|部门|项目|工作|发展|文化|产品|技术|这个|那个|这家|那家|一家|各家|所在|大型|中型|小型|上市|国企|外企|民企|正规|互联|联网|科技|软件|网络|金融|咨询|教育|制造|传统|创业|我们|你们|他们|你的|我的|他的|这|那|该|贵|的|地|得|我|你|他|她|它|们/;
const SAFE_METHOD_TOKENS = new Set(["jd", "star", "okr", "kpi", "smart"]);

/** 方法步骤里不该出现的用户专属说法；非空即整条丢弃。 */
export function approachProblems(step: string, material: string): string[] {
  const problems = new Set<string>();
  for (const m of step.matchAll(APPROACH_NUMBER)) problems.add(m[0].trim());
  const firstPerson = step.match(APPROACH_FIRST_PERSON);
  if (firstPerson) problems.add(firstPerson[0]);
  for (const term of [...APPROACH_TECH, ...APPROACH_NAMES]) {
    if (step.includes(term) && !material.includes(term)) problems.add(term);
  }
  for (const m of step.matchAll(APPROACH_ORG)) {
    const start = m.index ?? 0;
    const before = step.slice(Math.max(0, start - 3), start);
    if (before.length < 2 || GENERIC_ORG.test(before)) continue;
    const name = `${before.slice(-2)}${m[0]}`;
    if (!material.includes(name)) problems.add(name);
  }
  for (const token of ungroundedTokens(material, step)) {
    if (!SAFE_METHOD_TOKENS.has(token.toLowerCase())) problems.add(token);
  }
  return [...problems];
}

const PERCENT = /\d+(?:\.\d+)?\s*[%％]/g;
const normalizePercent = (s: string) => s.replace(/\s|％/g, "").replace(/%$/, "");

/** 回答和简历对不上的地方：简历写「主导」回答却说「参与」，或百分比对不上。只给线索，不下结论。 */
export function answerMismatch(bulletText: string, answer: string): string[] {
  const notes: string[] = [];
  const strong = bulletText.match(/主导|牵头|带领|带队|独立|独自|负责/);
  const weak = answer.match(WEAK_ROLE);
  if (strong && weak && !OWN_ROLE.test(answer)) {
    notes.push(`简历写的是「${strong[0]}」，你回答里说的是「${weak[0]}」，面试官很可能会追问这个落差。`);
  }
  const resumePercents = [...bulletText.matchAll(PERCENT)].map((m) => normalizePercent(m[0]));
  const answerPercents = [...answer.matchAll(PERCENT)].map((m) => normalizePercent(m[0]));
  if (
    resumePercents.length > 0 &&
    answerPercents.length > 0 &&
    !answerPercents.some((p) => resumePercents.includes(p))
  ) {
    notes.push(
      `简历写的是 ${resumePercents.map((p) => `${p}%`).join("、")}，你回答里说的是 ${answerPercents.map((p) => `${p}%`).join("、")}，数字要对得上。`,
    );
  }
  return notes;
}

export interface InterviewPrepExport {
  company: string;
  title: string;
  resumeSource: ResumeSource;
  updatedAt: string;
  questions: readonly InterviewQuestion[];
}

/** 题单导出成 Markdown，浏览器端直接生成下载。 */
export function interviewPrepMarkdown(prep: InterviewPrepExport): string {
  const lines = [
    `# 面试准备：${prep.company} · ${prep.title}`,
    "",
    `简历依据：${RESUME_SOURCE_LABEL[prep.resumeSource]}　生成时间：${prep.updatedAt}`,
    "",
  ];
  for (const kind of INTERVIEW_KINDS) {
    const items = prep.questions.filter((q) => q.kind === kind);
    if (items.length === 0) continue;
    lines.push(`## ${INTERVIEW_KIND_LABEL[kind]}`, "");
    items.forEach((q, i) => {
      lines.push(`### ${i + 1}. ${q.question}`, "", `- 考察点：${q.focus}`);
      if (q.source.bullet) lines.push(`- 简历出处：${q.source.bullet.heading} —— ${q.source.bullet.text}`);
      if (q.source.jd) lines.push(`- JD 出处：${q.source.jd}`);
      for (const r of q.risks) lines.push(`- ⚠ ${r.note}`);
      const approach = q.approach ?? [];
      if (approach.length > 0) {
        lines.push("", "#### 怎么答", "");
        approach.forEach((step, j) => {
          lines.push(`${j + 1}. ${step}`);
        });
      }
      if (q.answerPoints.length > 0) {
        lines.push("", "#### 你能用的", "");
        for (const p of q.answerPoints) lines.push(`- ${p.text}`);
      }
      if (q.missing) lines.push("", "#### 面试前要想好", "", `> ${q.missing}`);
      lines.push("");
    });
  }
  return lines.join("\n");
}

export interface TurnFeedback {
  /** 行为题和经历题才评 STAR；其余为 null。 */
  star: { situation: boolean; task: boolean; action: boolean; result: boolean } | null;
  metrics: boolean | null;
  consistency: "consistent" | "mismatch" | "unknown";
  notes: string[];
  /** 程序按简历原文比对出的对不上之处。 */
  mismatch: string[];
}

/** 回答里出现、画像里还没有的经历；只提示用户，模拟面试本身从不写画像。 */
export interface NewExperience {
  quote: string;
  summary: string;
}

export interface InterviewTurn {
  id: string;
  role: "interviewer" | "candidate";
  text: string;
  questionId?: string;
  /** 面试官这一轮抛出的题；追问时没有 source。 */
  question?: string;
  asked?: "question" | "follow_up" | "closing";
  source?: InterviewQuestion["source"];
  feedback?: TurnFeedback;
  newExperiences?: NewExperience[];
}

export interface InterviewSummary {
  overall: string;
  strengths: string[];
  improvements: string[];
  consistency: string[];
}

export interface InterviewSessionState {
  queue: string[];
  index: number;
  followUps: number;
  status: "active" | "finished";
  turns: InterviewTurn[];
  summary?: InterviewSummary;
}
