import type { Profile, ProfileSection } from "@talksume/core";

export interface FieldSpec {
  field: string;
  label: string;
  weight: number;
  required: boolean;
  question: string;
  strategy: string;
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
): FieldSpec => ({ field, label, weight, required, question, strategy });

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
      f("gpa", "成绩/排名", 0.5, false, "成绩或排名方便说一下吗？不想说也可以跳过。"),
    ],
  },
  {
    section: "experiences",
    label: "实习/工作经历",
    weight: 2,
    minItems: 1,
    kind: "list",
    newItemQuestion: "有没有实习或工作经历？没有的话告诉我一声就行。",
    newItemStrategy: "先问有没有；有就问公司、岗位、时间，再追问做了什么、结果如何。",
    fields: [
      f("company", "公司", 3, true, "是在哪家公司？"),
      f("title", "岗位", 3, true, "当时的岗位是什么？"),
      f("kind", "类型", 1, true, "这段是实习、全职还是兼职？"),
      f("start", "开始时间", 1, false, "是从什么时候开始的？"),
      f("end", "结束时间", 1, false, "是什么时候结束的？还在做的话告诉我。"),
      f(
        "bullets",
        "工作内容与成果",
        3,
        true,
        "在这段经历里你具体负责什么？有什么可以量化的成果吗？",
        "追问具体做了什么（动词开头）和结果，尽量要数字：提升百分比、节省时间、处理量、用户数。",
      ),
    ],
  },
  {
    section: "projects",
    label: "项目经历",
    weight: 3,
    minItems: 1,
    kind: "list",
    newItemQuestion: "挑一个你最拿得出手的项目聊聊吧，它叫什么、是做什么的？",
    newItemStrategy: "让用户先讲最有代表性的一个项目：名称、一句话背景，再按 STAR 往下问。",
    fields: [
      f("name", "项目名称", 3, true, "这个项目叫什么？"),
      f("role", "担任角色", 3, true, "你在项目里担任什么角色？"),
      f("techStack", "技术栈/工具", 1, false, "用到了哪些技术或工具？"),
      f("situation", "背景（S）", 1, false, "这个项目是为了解决什么问题、在什么背景下做的？"),
      f("task", "任务（T）", 1, false, "你负责的目标或任务是什么？"),
      f(
        "action",
        "行动（A）",
        3,
        true,
        "你具体做了什么？挑最关键的一两件讲讲。",
        "追问本人（而不是团队）做了什么：怎么做的、为什么这么做、遇到什么困难。",
      ),
      f(
        "result",
        "结果（R）",
        3,
        true,
        "最后的结果怎么样？",
        "追问到结果，并引导量化：性能/效率提升多少、用户数/调用量、获奖或上线情况。用户确实没有数字时，让他描述可观察的变化后接受。",
      ),
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
  kind: "field" | "new_item" | "quantify";
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
      });
  };
  for (const field of spec.fields) {
    add(field.field, field.label, field.weight, field.required, present(record[field.field]), "field");
  }
  if (spec.section === "projects" && present(record.result)) {
    add("result_quantified", "结果的量化数据", 1, true, isQuantified(String(record.result)), "quantify");
  }
  if (spec.section === "experiences" && Array.isArray(record.bullets) && record.bullets.length > 0) {
    add(
      "bullets_quantified",
      "成果的量化数据",
      1,
      true,
      record.bullets.some((b) => isQuantified(String(b))),
      "quantify",
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

export interface Slot extends MissingField {
  question: string;
  strategy: string;
}

export interface PickOptions extends CompletenessOptions {
  /** 每个字段已经追问过的次数，用于避免死缠烂打。 */
  askCounts?: Readonly<Record<string, number>>;
  maxAsks?: number;
  /** 用户跳过或说没有的字段 key，永远不主动再问。 */
  skipped?: ReadonlySet<string>;
}

export function toSlot(m: MissingField): Slot {
  const spec = SECTION_BY_NAME[m.section];
  if (m.kind === "new_item") return { ...m, question: spec.newItemQuestion, strategy: spec.newItemStrategy };
  if (m.kind === "quantify") {
    const target = m.field === "result_quantified" ? "项目结果" : "成果";
    return {
      ...m,
      question: `${target}有没有可以量化的数据？比如提升了多少、节省了多少时间、涉及多少用户。`,
      strategy: `${target}已经有了，但没有数字。追问一次具体数据；用户给不出就接受，不要反复追问。`,
    };
  }
  const field = spec.fields.find((x) => x.field === m.field);
  return { ...m, question: field?.question ?? `请补充${m.label}`, strategy: field?.strategy ?? "" };
}

/**
 * 先在流程顺序里找还缺必填项的第一个分区，再按权重取其中最重要的字段；
 * 必填项全部补完后才轮到选填项。
 */
export function pickNextSlot(profile: Profile, options: PickOptions = {}): Slot | null {
  const { missing } = computeCompleteness(profile, options);
  const maxAsks = options.maxAsks ?? 2;
  const askable = missing.filter(
    (m) =>
      !options.skipped?.has(m.key) &&
      (options.askCounts?.[m.key] ?? 0) < (m.kind === "quantify" ? 1 : maxAsks),
  );
  const order = new Map(SECTION_SPECS.map((s, i) => [s.section, i]));
  for (const wantRequired of [true, false]) {
    const pool = askable.filter((m) => m.required === wantRequired);
    if (pool.length === 0) continue;
    const firstSection = Math.min(...pool.map((m) => order.get(m.section) ?? 0));
    const inSection = pool.filter((m) => order.get(m.section) === firstSection);
    const best = inSection.reduce((a, b) => (b.weight > a.weight ? b : a));
    return toSlot(best);
  }
  return null;
}
