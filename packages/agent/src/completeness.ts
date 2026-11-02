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
  "把用户的叙述整理成 highlights：title 是 4～10 字的关键词短语，detail 照用户原话写，不改写、不夸大，数字只用用户说过的。";

/** 实习和项目共用的深挖四步：技术栈 → 负责什么 → 难点与做法 → 量化结果。 */
const deepDive = (what: string): FieldSpec[] => [
  f(
    "techStack",
    "技术栈/工具",
    2,
    true,
    `这段${what}主要用了哪些技术栈或工具？`,
    "techStack 一项一条，和已有的取并集。quickReplies 给 2～3 个贴合这段经历方向的组合（如「Java + MySQL」「Go」），再加一个「跳过」。",
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
    newItemQuestion: "有没有拿过奖或者荣誉？比如奖学金、竞赛。没有也没关系。",
    newItemStrategy: "先问有没有；有就问名称和时间。",
    fields: [
      f("name", "奖项名称", 2, true, "拿过什么奖？"),
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
  kind: "field" | "new_item" | "deepen" | "quantify";
  depth?: number;
}

export interface SectionCompleteness {
  section: ProfileSection;
  weight: number;
  score: number;
  completed: boolean;
}

export interface Completeness {
  score: number;
  sections: SectionCompleteness[];
  missing: MissingField[];
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

/** 只数带 title 的要点：旧 bullets / STAR 转来的无标题要点不算深挖过。 */
export function titledHighlights(record: Record<string, unknown>): number {
  const list = Array.isArray(record.highlights) ? record.highlights : [];
  return list.filter((h) => typeof h?.title === "string" && h.title.trim() && h.detail?.trim()).length;
}

const CHALLENGE =
  /难|挑战|瓶颈|问题|故障|排查|踩坑|解决|冲突|不一致|超卖|慢查询|卡顿|并发|抖动|泄漏|丢失|缺失/;

/** 只按条数算会被「负责 A、负责 B」糊弄过去，难点那条要真的在讲难点或做法。 */
function hasChallenge(record: Record<string, unknown>): boolean {
  const list = Array.isArray(record.highlights) ? record.highlights : [];
  return (
    titledHighlights(record) >= 2 && list.some((h) => CHALLENGE.test(`${h?.title ?? ""}${h?.detail ?? ""}`))
  );
}

function hasNumbers(record: Record<string, unknown>): boolean {
  const texts = [
    ...(Array.isArray(record.highlights)
      ? record.highlights.map((h) => `${h?.title ?? ""} ${h?.detail ?? ""}`)
      : []),
    ...(Array.isArray(record.bullets) ? record.bullets.map(String) : []),
    typeof record.result === "string" ? record.result : "",
  ];
  return texts.some((t) => isQuantified(t));
}

function fieldOk(section: ProfileSection, field: string, record: Record<string, unknown>): boolean {
  if (section === "experiences" || section === "projects") {
    if (field === "duty") return titledHighlights(record) >= 1;
    if (field === "challenge") return hasChallenge(record);
    if (field === "impact") return hasNumbers(record);
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
  for (const field of spec.fields) {
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

export function computeCompleteness(profile: Profile, options: CompletenessOptions = {}): Completeness {
  const completed = new Set(options.completedSections ?? []);
  const sections: SectionCompleteness[] = [];
  const missing: MissingField[] = [];

  for (const spec of SECTION_SPECS) {
    if (completed.has(spec.section)) {
      sections.push({ section: spec.section, weight: spec.weight, score: 1, completed: true });
      continue;
    }
    let sectionScore: number;
    const sectionMissing: MissingField[] = [];
    if (spec.kind === "object") {
      const record = profile[spec.section as "basics" | "intention"] as Record<string, unknown>;
      const scored = scoreRecord(spec, record, undefined, undefined);
      sectionScore = scored.score;
      sectionMissing.push(...scored.missing);
    } else {
      const items = profile[spec.section as "education"] as unknown as Array<
        Record<string, unknown> & { id: string }
      >;
      const scores: number[] = [];
      for (const item of items) {
        const scored = scoreRecord(spec, item, item.id, itemLabelOf(spec.section, item));
        scores.push(scored.score);
        sectionMissing.push(...scored.missing);
      }
      const count = Math.max(spec.minItems, items.length);
      while (scores.length < count) scores.push(0);
      sectionScore = count === 0 ? 1 : scores.reduce((a, b) => a + b, 0) / count;
      if (items.length < spec.minItems) {
        sectionMissing.push({
          key: `${spec.section}:_:_item`,
          section: spec.section,
          field: "_item",
          label: `新增${spec.label}`,
          weight: spec.fields.reduce((sum, field) => sum + field.weight, 0) / spec.fields.length,
          required: spec.section !== "awards" && spec.section !== "experiences",
          kind: "new_item",
        });
      }
    }
    sections.push({ section: spec.section, weight: spec.weight, score: sectionScore, completed: false });
    missing.push(...sectionMissing);
  }

  const totalWeight = sections.reduce((sum, s) => sum + s.weight, 0);
  const score = sections.reduce((sum, s) => sum + s.weight * s.score, 0) / totalWeight;
  return { score, sections, missing };
}

export interface PickOptions extends CompletenessOptions {
  /** 每个字段已经追问过的次数，用于避免死缠烂打。 */
  askCounts?: Readonly<Record<string, number>>;
  maxAsks?: number;
  /** 用户跳过或说没有的字段 key，永远不主动再问。 */
  skipped?: ReadonlySet<string>;
}

export interface Slot extends MissingField {
  question: string;
  strategy: string;
  replies?: string[];
}

export function toSlot(m: MissingField): Slot {
  const spec = SECTION_BY_NAME[m.section];
  if (m.kind === "new_item") return { ...m, question: spec.newItemQuestion, strategy: spec.newItemStrategy };
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
 * 三个阶段：先按分区顺序把各分区铺开（每个分区取最重要的缺项），
 * 再按条目顺序逐段深挖（技术栈 → 负责什么 → 难点 → 量化结果），最后才问选填项。
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
        (order.get(a.section) ?? 0) - (order.get(b.section) ?? 0) ||
        itemOrder(a) - itemOrder(b) ||
        (a.depth ?? 0) - (b.depth ?? 0),
    )[0];
  if (deep) return toSlot(deep);

  const rest = firstOfSection(askable.filter((m) => !m.required && !isBreadth(m)));
  return rest ? toSlot(rest) : null;
}
