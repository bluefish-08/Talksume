import type { Profile, ProfileSection } from "@talksume/core";

export interface FieldSpec {
  field: string;
  label: string;
  weight: number;
  required: boolean;
  question: string;
  strategy: string;
  /** 深挖步骤（1 起）：分区铺开后再按此顺序逐段追问。 */
  depth?: number;
  /** 模型没给快捷回答时兜底用。 */
  replies?: string[];
}

export interface SectionSpec {
  section: ProfileSection;
  label: string;
  weight: number;
  /** 至少需要的条目数；对象型分区（basics、intention）为 0。 */
  minItems: number;
  kind: "object" | "list";
  newItemQuestion: string;
  newItemStrategy: string;
  fields: FieldSpec[];
}

const f = (
  field: string,
  label: string,
  weight: number,
  required: boolean,
  question: string,
  strategy = "",
  extra: Pick<FieldSpec, "depth" | "replies"> = {},
): FieldSpec => ({ field, label, weight, required, question, strategy, ...extra });

const HIGHLIGHT_RULE =
  "把用户的叙述整理成 highlights：title 是 4～10 字的关键词短语，detail 写成简历用语（去掉「我」、动词开头），只用原话里的事实，不夸大，数字只用用户说过的。";

/** 实习和项目共用的深挖四步：技术栈 → 负责什么 → 难点与做法 → 量化结果。 */
const deepDive = (what: string): FieldSpec[] => [
  f(
    "techStack",
    "技术栈/工具",
    2,
    true,
    `这段${what}主要用了哪些技术栈或工具？`,
    "techStack 一项一条，和已有的取并集。quickReplies 给 2～3 个贴合这段经历方向的组合（如「Java + MySQL」「Go」），再加一个「跳过」。不涉及技术的活动直接用 skip_field 跳过，不要硬问。",
    { depth: 1 },
  ),
  f(
    "duty",
    "具体负责的内容",
    3,
    true,
    `在这段${what}里，你具体负责哪一块？`,
    `追问本人（不是团队）负责的模块和做了什么。${HIGHLIGHT_RULE}`,
    { depth: 2 },
  ),
  f(
    "challenge",
    "难点与做法",
    2,
    true,
    "做的过程中遇到过什么难点？你是怎么解决的？",
    `问一个最有代表性的难点和本人的做法，单独整理成一条 highlight。${HIGHLIGHT_RULE}`,
    { depth: 3, replies: ["没遇到什么难点", "跳过这个"] },
  ),
  f(
    "impact",
    "量化结果",
    2,
    true,
    "最后效果怎么样？有没有数字，比如性能提升、用户量、效率或比例？",
    "只问一次。用户给了数字就补进对应 highlight 的 detail（沿用原 title，写合并后的完整文本）；说没有数字、记不清，就用 skip_field 跳过，不要再追问。",
    { depth: 4, replies: ["没有具体数字", "记不清了"] },
  ),
];

/** 分区顺序即对话推进顺序。 */
export const SECTION_SPECS: readonly SectionSpec[] = [
  {
    section: "basics",
    label: "基本信息",
    weight: 2,
    minItems: 0,
    kind: "object",
    newItemQuestion: "",
    newItemStrategy: "",
    fields: [
      f("name", "姓名", 3, true, "先认识一下，怎么称呼你？"),
      f("phone", "手机号", 2, true, "方便留一个手机号吗？投递简历时 HR 会用到。"),
      f("email", "邮箱", 2, true, "常用邮箱是哪个？"),
      f("city", "所在城市", 1, false, "你现在在哪个城市？"),
      f("summary", "一句话自我介绍", 1, false, "用一句话介绍一下自己？比如你的专业方向和最擅长的事。"),
      f(
        "links",
        "个人链接",
        0.5,
        false,
        "有 GitHub、技术博客或作品集链接吗？没有就跳过。",
        "links 每项 {label, url}，url 照用户给的写。",
        { replies: ["没有", "跳过这个"] },
      ),
    ],
  },
  {
    section: "education",
    label: "教育经历",
    weight: 3,
    minItems: 1,
    kind: "list",
    newItemQuestion: "你的学校和专业是什么？",
    newItemStrategy: "先问最高学历的学校，再依次补学位、专业、起止时间。",
    fields: [
      f("school", "学校", 3, true, "你在哪所学校读书？"),
      f(
        "degree",
        "学位",
        3,
        true,
        "读的是专科、本科、硕士还是博士？",
        "学位只能是 associate/bachelor/master/phd 之一。",
      ),
      f("major", "专业", 2, true, "专业是什么？"),
      f("start", "入学时间", 1, false, "是哪一年入学的？", "时间写成 YYYY-MM，只知道年份时月份按 09 记。"),
      f("end", "毕业时间", 1, false, "预计或实际是哪一年毕业？", "时间写成 YYYY-MM；还在读用预计毕业时间。"),
      f(
        "gpa",
        "成绩/排名",
        0.5,
        false,
        "GPA 或专业排名方便说一下吗？说一个就行，不想说也可以跳过。",
        "GPA 写 gpa（如 3.7/4.0），排名写 rank（如 专业前 10%、3/120），有一个就够。",
        { replies: ["不太想说", "跳过这个"] },
      ),
      f(
        "courses",
        "主修课程",
        0.5,
        false,
        "挑几门和求职方向相关的主修课程？不需要可以跳过。",
        "courses 一门一条。",
        { replies: ["跳过这个"] },
      ),
    ],
  },
  {
    section: "experiences",
    label: "实习/工作经历",
    weight: 2,
    minItems: 1,
    kind: "list",
    newItemQuestion: "有没有实习或工作经历？没有的话告诉我一声就行。",
    newItemStrategy: "先问有没有；有就问公司、岗位、时间，细节等各分区铺开后再逐段深挖。",
    fields: [
      f("company", "公司", 3, true, "是在哪家公司？"),
      f("title", "岗位", 3, true, "当时的岗位是什么？"),
      f("kind", "类型", 1, true, "这段是实习、全职还是兼职？"),
      f("start", "开始时间", 1, false, "是从什么时候开始的？"),
      f("end", "结束时间", 1, false, "是什么时候结束的？还在做的话告诉我。"),
      ...deepDive("实习"),
    ],
  },
  {
    section: "projects",
    label: "项目经历",
    weight: 3,
    minItems: 1,
    kind: "list",
    newItemQuestion: "挑一个你最拿得出手的项目聊聊吧，它叫什么、是做什么的？",
    newItemStrategy: "让用户先讲最有代表性的一个项目：名称、一句话背景和角色，细节等各分区铺开后再逐段深挖。",
    fields: [
      f("name", "项目名称", 3, true, "这个项目叫什么？"),
      f("role", "担任角色", 2, true, "你在项目里担任什么角色？"),
      f("situation", "项目背景", 1, false, "这个项目是为了解决什么问题、在什么背景下做的？"),
      ...deepDive("项目"),
    ],
  },
  {
    section: "skills",
    label: "技能",
    weight: 2,
    minItems: 3,
    kind: "list",
    newItemQuestion: "你比较熟悉哪些技能或工具？可以一次多说几个。",
    newItemStrategy: "一次收集多个技能，批量写入；掌握程度只在用户主动提到时记录。",
    fields: [f("name", "技能名称", 1, true, "还有哪些技能或工具你比较熟？")],
  },
  {
    section: "intention",
    label: "求职意向",
    weight: 3,
    minItems: 0,
    kind: "object",
    newItemQuestion: "",
    newItemStrategy: "",
    fields: [
      f("roles", "意向岗位", 3, true, "你想投什么方向的岗位？"),
      f("cities", "意向城市", 2, true, "想在哪些城市工作？"),
      f("jobType", "求职类型", 2, true, "找的是实习、校招还是社招？", "取值 internship/campus/experienced。"),
      f("availableFrom", "到岗时间", 1, false, "最早什么时候可以到岗？", "时间写成 YYYY-MM。"),
      f("salaryMin", "期望薪资", 1, false, "对月薪有期望吗？不方便说可以跳过。", "单位是元/月，填整数。"),
    ],
  },
  {
    section: "awards",
    label: "获奖与荣誉",
    weight: 1,
    minItems: 1,
    kind: "list",
    newItemQuestion: "有没有拿过奖、荣誉或证书？比如奖学金、竞赛、计算机等级证书。没有也没关系。",
    newItemStrategy: "先问有没有；有就问名称和时间。证书也写进 awards，外语成绩写 basics.languages。",
    fields: [
      f("name", "奖项/证书名称", 2, true, "拿过什么奖或证书？"),
      f("date", "获奖时间", 1, false, "是什么时候拿的？"),
      f("description", "说明", 0.5, false, "可以补充一下这个奖的含金量吗？比如名次或评选范围。"),
    ],
  },
];

export const SECTION_BY_NAME = Object.fromEntries(SECTION_SPECS.map((s) => [s.section, s])) as Record<
  ProfileSection,
  SectionSpec
>;

export interface MissingField {
  key: string;
  section: ProfileSection;
  /** 条目 ID；对象型分区或「新增条目」为空。 */
  itemId?: string;
  itemLabel?: string;
  field: string;
  label: string;
  weight: number;
  required: boolean;
  kind: "field" | "new_item" | "deepen" | "quantify" | "probe";
  depth?: number;
  /** 挖掘角度按画像定制的问法。 */
  question?: string;
}

export interface SectionCompleteness {
  section: ProfileSection;
  weight: number;
  /** 这个分区写进画像的内容有多充实，跳过不加分。 */
  score: number;
  /** 问完了：内容齐了，或用户跳过、说没有。 */
  completed: boolean;
}

/** 简历本身的短板，和问没问过无关。 */
export interface QualityGap {
  key: string;
  /** 名词短语，界面拼成「还缺 X」。 */
  label: string;
  /** 点击后发给对话的消息。 */
  prompt: string;
}

export interface Completeness {
  /** 简历充实度：只看画像里真有的内容，用户跳过的不算完成。界面上显示的都是它。 */
  score: number;
  /** 建档进度：跳过、说没有的都算问完，只用来决定还要不要追问。 */
  progress: number;
  sections: SectionCompleteness[];
  missing: MissingField[];
  gaps: QualityGap[];
  /** 经历太少时「投递前可以补的东西」，是建议，不进简历。 */
  tips: string[];
}

export interface CompletenessOptions {
  /** 被 complete_section 标记完成（含用户明确跳过）的分区，按 1.0 计分。 */
  completedSections?: readonly ProfileSection[];
}

const QUANTIFIED =
  /[0-9０-９]|百分之|[一二三四五六七八九十百千万两]+\s*(?:倍|人|次|个|条|万|千|%|％|天|小时|分钟|秒)/;

export function isQuantified(text: string | undefined): boolean {
  return !!text && QUANTIFIED.test(text);
}

function present(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

const CHALLENGE =
  /难|挑战|瓶颈|问题|故障|排查|踩坑|解决|冲突|不一致|超卖|慢查询|卡顿|并发|抖动|泄漏|丢失|缺失/;

/** 经历里用户讲过的每件事：要点，没有要点时是旧的 bullets 和项目的做法、结果。老数据讲过的不再重复问。 */
function contentOf(record: Record<string, unknown>): { duty: string[]; all: string[] } {
  const highlights = Array.isArray(record.highlights) ? record.highlights : [];
  if (highlights.length > 0) {
    const texts = highlights.map((h) => `${h?.title ?? ""} ${h?.detail ?? ""}`.trim()).filter(Boolean);
    return { duty: texts, all: texts };
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? [v.trim()] : []);
  const bullets = Array.isArray(record.bullets) ? record.bullets.flatMap(str) : [];
  const duty = [...bullets, ...str(record.action)];
  return { duty, all: [...duty, ...str(record.result)] };
}

/** 只按条数算会被「负责 A、负责 B」糊弄过去，难点那条要真的在讲难点或做法。 */
function hasChallenge(record: Record<string, unknown>): boolean {
  const { all } = contentOf(record);
  return all.length >= 2 && all.some((t) => CHALLENGE.test(t));
}

function fieldOk(section: ProfileSection, field: string, record: Record<string, unknown>): boolean {
  if (section === "experiences" || section === "projects") {
    if (field === "duty") return contentOf(record).duty.length >= 1;
    if (field === "challenge") return hasChallenge(record);
    if (field === "impact") return contentOf(record).all.some((t) => isQuantified(t));
  }
  if (section === "education" && field === "gpa") return present(record.gpa) || present(record.rank);
  return present(record[field]);
}

function itemLabelOf(section: ProfileSection, item: Record<string, unknown>): string | undefined {
  const key = section === "education" ? "school" : section === "experiences" ? "company" : "name";
  const value = item[key];
  return typeof value === "string" ? value : undefined;
}

interface Scored {
  score: number;
  missing: MissingField[];
}

function scoreRecord(
  spec: SectionSpec,
  record: Record<string, unknown>,
  itemId: string | undefined,
  itemLabel: string | undefined,
): Scored {
  let total = 0;
  let got = 0;
  const missing: MissingField[] = [];
  const add = (
    field: string,
    label: string,
    weight: number,
    required: boolean,
    ok: boolean,
    kind: MissingField["kind"],
    depth?: number,
  ) => {
    total += weight;
    if (ok) got += weight;
    else
      missing.push({
        key: `${spec.section}:${itemId ?? "_"}:${field}`,
        section: spec.section,
        ...(itemId ? { itemId } : {}),
        ...(itemLabel ? { itemLabel } : {}),
        field,
        label,
        weight,
        required,
        kind,
        ...(depth ? { depth } : {}),
      });
  };
  const campus = spec.section === "projects" && record.kind === "campus";
  for (const field of spec.fields) {
    if (campus && field.field === "techStack") continue;
    const kind = field.field === "impact" ? "quantify" : field.depth && field.depth > 1 ? "deepen" : "field";
    add(
      field.field,
      field.label,
      field.weight,
      field.required,
      fieldOk(spec.section, field.field, record),
      kind,
      field.depth,
    );
  }
  return { score: total === 0 ? 1 : got / total, missing };
}

interface SectionScored extends Scored {
  /** 实际条目各自的得分，不含按 minItems 补的空位。 */
  itemScores: number[];
}

function scoreSection(spec: SectionSpec, profile: Profile): SectionScored {
  if (spec.kind === "object") {
    const record = profile[spec.section as "basics" | "intention"] as Record<string, unknown>;
    return { ...scoreRecord(spec, record, undefined, undefined), itemScores: [] };
  }
  const items = profile[spec.section as "education"] as unknown as Array<
    Record<string, unknown> & { id: string }
  >;
  const itemScores: number[] = [];
  const missing: MissingField[] = [];
  for (const item of items) {
    const scored = scoreRecord(spec, item, item.id, itemLabelOf(spec.section, item));
    itemScores.push(scored.score);
    missing.push(...scored.missing);
  }
  const count = Math.max(spec.minItems, items.length);
  const score = count === 0 ? 1 : itemScores.reduce((a, b) => a + b, 0) / count;
  if (items.length < spec.minItems) {
    missing.push({
      key: `${spec.section}:_:_item`,
      section: spec.section,
      field: "_item",
      label: `新增${spec.label}`,
      weight: spec.fields.reduce((sum, field) => sum + field.weight, 0) / spec.fields.length,
      required: spec.section !== "awards" && spec.section !== "experiences",
      kind: "new_item",
    });
  }
  return { score, missing, itemScores };
}

/**
 * 简历充实度的权重：实习和项目合并成「经历」占一半，两段写充实的经历拿满；
 * 没有任何经历时，其他分区全满也不到一半。
 */
const QUALITY_WEIGHTS = {
  basics: 1.5,
  education: 1.5,
  evidence: 6,
  skills: 1.25,
  intention: 1.25,
  awards: 0.5,
};
const EVIDENCE_TARGET = 2;

function evidenceItems(profile: Profile): Array<Record<string, unknown> & { id: string }> {
  return [...profile.experiences, ...profile.projects] as unknown as Array<
    Record<string, unknown> & { id: string }
  >;
}

function qualityScore(profile: Profile, scored: Map<ProfileSection, SectionScored>): number {
  const top = [
    ...(scored.get("experiences")?.itemScores ?? []),
    ...(scored.get("projects")?.itemScores ?? []),
  ]
    .sort((a, b) => b - a)
    .slice(0, EVIDENCE_TARGET);
  const evidence = top.reduce((a, b) => a + b, 0) / EVIDENCE_TARGET;
  const extras =
    profile.awards.length > 0 ||
    profile.education.some((e) => (e.honors?.length ?? 0) > 0) ||
    (profile.basics.languages?.length ?? 0) > 0;
  const parts: [number, number][] = [
    [QUALITY_WEIGHTS.basics, scored.get("basics")?.score ?? 0],
    [QUALITY_WEIGHTS.education, scored.get("education")?.score ?? 0],
    [QUALITY_WEIGHTS.evidence, evidence],
    [QUALITY_WEIGHTS.skills, scored.get("skills")?.score ?? 0],
    [QUALITY_WEIGHTS.intention, scored.get("intention")?.score ?? 0],
    [QUALITY_WEIGHTS.awards, extras ? 1 : 0],
  ];
  const total = parts.reduce((sum, [w]) => sum + w, 0);
  return parts.reduce((sum, [w, s]) => sum + w * s, 0) / total;
}

export function qualityGaps(profile: Profile): QualityGap[] {
  const gaps: QualityGap[] = [];
  const items = evidenceItems(profile);
  if (items.length === 0) {
    gaps.push({
      key: "evidence",
      label: "能证明动手能力的经历",
      prompt:
        "我没有实习和正式项目，帮我从课程设计、比赛、社团、兼职这些里挖一挖能写进简历的经历，一次问我一个。",
    });
  } else if (items.length < EVIDENCE_TARGET) {
    gaps.push({
      key: "evidence_more",
      label: "第二段项目或实践经历",
      prompt: "帮我再找一段能写进简历的项目或实践经历，比如课程设计、比赛、社团或兼职，一次问我一个。",
    });
  }
  for (const item of items) {
    if (contentOf(item).duty.length > 0) continue;
    const name = String(item.name ?? item.company ?? "");
    gaps.push({
      key: `thin:${item.id}`,
      label: `「${name}」的具体做法`,
      prompt: `帮我补充「${name}」里我具体做了什么、遇到什么问题、怎么解决的，请一项一项问我。`,
    });
  }
  const { basics } = profile;
  if (!basics.name?.trim()) gaps.push({ key: "name", label: "姓名", prompt: "帮我补上姓名。" });
  if (!basics.phone?.trim() && !basics.email?.trim())
    gaps.push({ key: "contact", label: "联系方式", prompt: "帮我补上手机号和邮箱。" });
  if (profile.education.length === 0)
    gaps.push({ key: "education", label: "教育经历", prompt: "帮我补上教育经历，请一项一项问我。" });
  if (profile.skills.length < 3)
    gaps.push({
      key: "skills",
      label: "至少 3 项技能",
      prompt: "帮我整理专业技能，问问我会哪些技术和工具。",
    });
  if (profile.intention.roles.length === 0)
    gaps.push({ key: "roles", label: "意向岗位", prompt: "帮我确定求职意向，先问我想投什么岗位。" });
  return gaps;
}

const TIP_TRACKS: { match: RegExp; tips: string[] }[] = [
  {
    match: /前端|web|vue|react|javascript|typescript|html|css|小程序/i,
    tips: [
      "用 Vue 或 React 做一个 3～5 个页面的小应用（如记账本、待办清单），调用公开接口拿数据，部署成能在线访问的网址",
      "把一门课的作业页面重做一遍，做到手机上也能正常显示，代码放到 GitHub 并写清 README",
    ],
  },
  {
    match: /测试|qa/i,
    tips: [
      "挑一个开源或自己做的小系统，写一份测试用例，用 Postman 或 JMeter 做接口测试，记录发现的问题",
      "用 Python + Selenium 写几条自动化测试脚本，放到 GitHub",
    ],
  },
  {
    match: /运维|实施|devops|linux|网络/i,
    tips: [
      "在虚拟机或云服务器上搭一套 Linux + Nginx + MySQL 环境，把部署步骤写成文档",
      "写几个 Shell 脚本做日志清理、定时备份，说清楚解决了什么问题",
    ],
  },
  {
    match: /数据|分析|算法|python|excel|bi\b/i,
    tips: [
      "找一份公开数据集（如城市空气质量、电影评分），用 Python 或 Excel 做清洗、分析和可视化，写一页结论",
      "在 MySQL 里练一组业务查询（如销售统计、用户留存），整理成文档放到 GitHub",
    ],
  },
  {
    match: /java|spring|后端|服务端|开发|golang|\bgo\b|php|node|c\+\+|mysql/i,
    tips: [
      "用 Spring Boot + MySQL 做一个小型管理系统（如图书借阅、宿舍报修），实现登录、增删改查和分页查询，代码放到 GitHub 并写清 README",
      "在这个系统上再做一处改进，比如加 Redis 缓存或部署到云服务器，记下遇到的问题和解决办法，面试时能讲清楚",
    ],
  },
];

const GENERIC_TIPS = [
  "从做过的课程作业里挑一个，按「背景—我做了什么—遇到的问题—怎么解决」整理出来，回来跟我聊，就能写成项目经历",
  "考一个和目标岗位相关的证书，或做一个线上实训项目，做完能写进简历",
];

/** 先看意向岗位，没有再看技能，决定建议往哪个方向做。 */
export function prepTips(profile: Profile): string[] {
  if (evidenceItems(profile).length >= EVIDENCE_TARGET) return [];
  const sources = [profile.intention.roles.join(" "), profile.skills.map((s) => s.name).join(" ")];
  for (const source of sources) {
    const track = source && TIP_TRACKS.find((t) => t.match.test(source));
    if (track) return track.tips;
  }
  return GENERIC_TIPS;
}

interface ProbeSpec {
  field: string;
  label: string;
  question: string;
  replies: string[];
  /** 已有经历里出现这些字样，说明这个角度挖过了。 */
  covered: RegExp;
}

export const PROBES: readonly ProbeSpec[] = [
  {
    field: "probe_course",
    label: "课程设计/大作业/毕设",
    question: "课程设计、大作业或者毕业设计做过吗？这些都能写成项目经历。",
    replies: ["做过课程设计", "做过毕业设计", "都没做过"],
    covered: /课程设计|课设|大作业|毕业设计|毕设|实训|课程项目/,
  },
  {
    field: "probe_selfmade",
    label: "自学作品/开源/博客",
    question: "有没有自己学着做过的东西？比如跟着教程做的练手项目、放到 GitHub 上的代码或者写过的技术博客。",
    replies: ["跟着教程做过", "写过博客", "没有"],
    covered: /自学|教程|练手|开源|github|博客/i,
  },
  {
    field: "probe_campus",
    label: "比赛/社团/志愿者",
    question: "参加过比赛、社团、学生会或者志愿者活动吗？",
    replies: ["参加过比赛", "在社团或学生会", "做过志愿者", "都没有"],
    covered: /比赛|竞赛|社团|协会|学生会|志愿|班委|团支部/,
  },
  {
    field: "probe_work",
    label: "兼职/勤工俭学/帮老师做事",
    question: "做过兼职、勤工俭学，或者帮老师、同学做过什么东西吗？",
    replies: ["做过兼职", "帮老师做过东西", "没有"],
    covered: /兼职|勤工|家教|帮老师|助教|帮同学|parttime/,
  },
];

export const PROBE_BY_FIELD = Object.fromEntries(PROBES.map((p) => [p.field, p])) as Record<
  string,
  ProbeSpec
>;

/** 用画像里已有的课程或技能提一个具体候选，比笼统地问更容易让人想起来。 */
function courseQuestion(profile: Profile): string | undefined {
  const course = profile.education.flatMap((e) => e.courses)[0];
  if (course) return `你学过「${course}」，这门课有没有做过课程设计或者大作业？别的课的课设、毕业设计也算。`;
  const skills = profile.skills.slice(0, 2).map((s) => s.name);
  if (skills.length > 0)
    return `课上学 ${skills.join("、")} 的时候，有没有做过课程设计或者大作业？毕业设计也算。`;
  return undefined;
}

/** 经历不到两段时换角度挖；一段都没有时和各分区的必填项一起问，有一段时等深挖完再问。 */
function probeMissing(profile: Profile): MissingField[] {
  const items = evidenceItems(profile);
  if (items.length >= EVIDENCE_TARGET) return [];
  const text = JSON.stringify(items);
  const course = courseQuestion(profile);
  return PROBES.filter((p) => !p.covered.test(text)).map((p, i) => ({
    key: `projects:_:${p.field}`,
    section: "projects",
    field: p.field,
    label: p.label,
    weight: 1 - i * 0.1,
    required: items.length === 0,
    kind: "probe",
    ...(p.field === "probe_course" && course ? { question: course } : {}),
  }));
}

export function computeCompleteness(profile: Profile, options: CompletenessOptions = {}): Completeness {
  const completed = new Set(options.completedSections ?? []);
  const sections: SectionCompleteness[] = [];
  const missing: MissingField[] = [];
  const scored = new Map<ProfileSection, SectionScored>();
  let progressSum = 0;
  let weightSum = 0;

  for (const spec of SECTION_SPECS) {
    const result = scoreSection(spec, profile);
    scored.set(spec.section, result);
    const done = completed.has(spec.section);
    sections.push({ section: spec.section, weight: spec.weight, score: result.score, completed: done });
    progressSum += spec.weight * (done ? 1 : result.score);
    weightSum += spec.weight;
    if (!done) missing.push(...result.missing);
  }
  missing.push(...probeMissing(profile));

  return {
    score: qualityScore(profile, scored),
    progress: progressSum / weightSum,
    sections,
    missing,
    gaps: qualityGaps(profile),
    tips: prepTips(profile),
  };
}

export interface PickOptions extends CompletenessOptions {
  /** 每个字段已经追问过的次数，用于避免死缠烂打。 */
  askCounts?: Readonly<Record<string, number>>;
  maxAsks?: number;
  /** 用户跳过或说没有的字段 key，永远不主动再问。 */
  skipped?: ReadonlySet<string>;
  /** 正在聊的实习/项目条目，深挖时先把它问完再换下一段。 */
  focusItemId?: string;
}

export interface Slot extends MissingField {
  question: string;
  strategy: string;
  replies?: string[];
}

const PROBE_STRATEGY =
  "用户之前说没有项目或实习，多半是觉得课程作业、社团这些不算，这里换个角度只问这一个。附上 quickReplies。" +
  "用户说有但没细讲，就追问做的是什么、自己负责哪块，不要转去问别的角度；讲清楚后照常写入：课程设计、练手作品、帮老师同学做的东西、比赛作品写 projects；社团、学生会、志愿者、组织过的活动也写 projects 并带 kind=campus（简历上单列「校园经历」，不问技术栈）；兼职和勤工俭学写 experiences（kind=parttime），奖项和证书写 awards。" +
  "用户说没有，就用 skip_field 跳过这个角度。";

export function toSlot(m: MissingField): Slot {
  const spec = SECTION_BY_NAME[m.section];
  if (m.kind === "new_item") return { ...m, question: spec.newItemQuestion, strategy: spec.newItemStrategy };
  if (m.kind === "probe") {
    const probe = PROBE_BY_FIELD[m.field];
    const proposed = m.question && m.question !== probe?.question;
    return {
      ...m,
      question: m.question ?? probe?.question ?? `请补充${m.label}`,
      strategy: proposed
        ? `${PROBE_STRATEGY}参考问法是按用户说过的课程或技能提的候选，用户确认之前不能写入。`
        : PROBE_STRATEGY,
      replies: proposed ? ["做过", "没做过"] : (probe?.replies ?? []),
    };
  }
  const field = spec.fields.find((x) => x.field === m.field);
  return {
    ...m,
    question: field?.question ?? `请补充${m.label}`,
    strategy: field?.strategy ?? "",
    ...(field?.replies ? { replies: field.replies } : {}),
  };
}

/** 旧版本记下的「没有数字」跳过，对新的量化结果项同样有效。 */
function legacySkipKeys(m: MissingField): string[] {
  if (m.field !== "impact" || !m.itemId) return [];
  const old = m.section === "projects" ? "result_quantified" : "bullets_quantified";
  return [`${m.section}:${m.itemId}:${old}`];
}

export function isSkipped(m: MissingField, skipped: ReadonlySet<string> | undefined): boolean {
  return !!skipped && (skipped.has(m.key) || legacySkipKeys(m).some((k) => skipped.has(k)));
}

/** 铺开阶段要问的项：各分区的必填基础字段，加上「有没有实习」。 */
function isBreadth(m: MissingField): boolean {
  if (m.depth) return false;
  return m.required || (m.kind === "new_item" && m.section === "experiences");
}

/**
 * 四个阶段：先按分区顺序把各分区铺开（每个分区取最重要的缺项；一段经历都没有时挖掘角度也在这里），
 * 再按条目顺序逐段深挖（技术栈 → 负责什么 → 难点 → 量化结果），然后换角度再挖一段经历，最后才问选填项。
 */
export function pickNextSlot(profile: Profile, options: PickOptions = {}): Slot | null {
  const { missing } = computeCompleteness(profile, options);
  const maxAsks = options.maxAsks ?? 2;
  const askable = missing.filter(
    (m) =>
      !isSkipped(m, options.skipped) &&
      (options.askCounts?.[m.key] ?? 0) < (m.kind === "quantify" ? 1 : maxAsks),
  );
  const order = new Map(SECTION_SPECS.map((s, i) => [s.section, i]));
  const firstOfSection = (pool: MissingField[]): MissingField | undefined => {
    if (pool.length === 0) return undefined;
    const firstSection = Math.min(...pool.map((m) => order.get(m.section) ?? 0));
    const inSection = pool.filter((m) => order.get(m.section) === firstSection);
    return inSection.reduce((a, b) => (b.weight > a.weight ? b : a));
  };

  const breadth = firstOfSection(askable.filter(isBreadth));
  if (breadth) return toSlot(breadth);

  const itemOrder = (m: MissingField) => {
    const items = profile[m.section as "experiences" | "projects"] as { id: string }[];
    return items.findIndex((item) => item.id === m.itemId);
  };
  const deep = askable
    .filter((m) => m.depth && m.required)
    .sort(
      (a, b) =>
        Number(b.itemId === options.focusItemId) - Number(a.itemId === options.focusItemId) ||
        (order.get(a.section) ?? 0) - (order.get(b.section) ?? 0) ||
        itemOrder(a) - itemOrder(b) ||
        (a.depth ?? 0) - (b.depth ?? 0),
    )[0];
  if (deep) return toSlot(deep);

  const probe = askable.filter((m) => m.kind === "probe").sort((a, b) => b.weight - a.weight)[0];
  if (probe) return toSlot(probe);

  const rest = firstOfSection(askable.filter((m) => !m.required && !isBreadth(m)));
  return rest ? toSlot(rest) : null;
}
