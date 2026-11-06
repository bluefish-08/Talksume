import { polishItemKey, polishSourceHash } from "./polish.ts";
import type { ResumeContent, ResumeItem } from "./resume.ts";

export const TAILOR_ITEM_SECTIONS = ["experiences", "projects", "campus"] as const;
export type TailorItemSection = (typeof TAILOR_ITEM_SECTIONS)[number];

/** 定制档位：逐档放宽措辞自由度，三档共用出处校验。 */
export const TAILOR_LEVELS = ["light", "keywords", "deep"] as const;
export type TailorLevel = (typeof TAILOR_LEVELS)[number];
export const DEFAULT_TAILOR_LEVEL: TailorLevel = "light";

export const TAILOR_LEVEL_LABELS: Record<TailorLevel, { name: string; hint: string }> = {
  light: { name: "微调", hint: "只调整顺序和措辞，不加关键词" },
  keywords: { name: "嵌入关键词", hint: "把你已有的技能换成岗位 JD 的说法" },
  deep: { name: "深度改写", hint: "重写措辞更贴近岗位，仍不新增事实" },
};

interface ChangeBase {
  id: string;
  reason?: string;
  /** 定制结果里出现、简历和用户原话里都没有的数字或词；非空即不能采用。 */
  violations: string[];
}

/** 针对某个岗位的一处调整；只改顺序和措辞，事实来源（factIds）不动。 */
export type TailorChange =
  | (ChangeBase & { kind: "summary"; before?: string; after: string })
  | (ChangeBase & {
      kind: "bullet";
      itemKey: string;
      heading: string;
      sourceHash: string;
      before: string;
      after: string;
    })
  | (ChangeBase & {
      kind: "bullet_order";
      itemKey: string;
      heading: string;
      /** 原文哈希的新顺序；before/after 只用于展示。 */
      order: string[];
      before: string[];
      after: string[];
    })
  | (ChangeBase & { kind: "item_order"; section: TailorItemSection; before: string[]; after: string[] })
  | (ChangeBase & { kind: "skill_order"; before: string[]; after: string[] });

export type TailorChangeKind = TailorChange["kind"];

const SKILL_SEPARATOR = "、";
// profileToResume 没有分组时按熟练度出条目，这类条目保持原来的先后
const LEVEL_HEADINGS = new Set(["精通", "熟练", "熟悉", "了解", "其他", ""]);

/** 已排序的在前（按 order 先后），其余保持原相对顺序接在后面。 */
export function sortByOrder<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  order: readonly string[],
): T[] {
  const rank = new Map(order.map((key, i) => [key, i]));
  return items
    .map((item, index) => ({ item, index, rank: rank.get(keyOf(item)) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
    .map((entry) => entry.item);
}

export function skillNames(resume: ResumeContent): string[] {
  const names = resume.sections
    .filter((s) => s.kind === "skills")
    .flatMap((s) => s.items.flatMap((item) => item.bullets.flatMap((b) => b.text.split(SKILL_SEPARATOR))))
    .map((n) => n.trim())
    .filter(Boolean);
  return [...new Set(names)];
}

function orderSkills(items: ResumeItem[], priority: readonly string[]): ResumeItem[] {
  const rank = new Map(priority.map((name, i) => [name, i]));
  const rankOf = (name: string) => rank.get(name.trim()) ?? Number.POSITIVE_INFINITY;
  const sorted = items.map((item) => ({
    ...item,
    bullets: item.bullets.map((b) => {
      const names = b.text.split(SKILL_SEPARATOR);
      if (names.length < 2) return b;
      return { ...b, text: sortByOrder(names, (n) => n.trim(), priority).join(SKILL_SEPARATOR) };
    }),
  }));
  if (sorted.some((item) => LEVEL_HEADINGS.has(item.heading.trim()))) return sorted;
  const best = (item: ResumeItem) =>
    Math.min(...item.bullets.flatMap((b) => b.text.split(SKILL_SEPARATOR).map(rankOf)));
  return sorted
    .map((item, index) => ({ item, index, rank: best(item) }))
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
    .map((entry) => entry.item);
}

/** 先排序再按原文哈希替换措辞，两类调整互不干扰；找不到对应原文的调整直接忽略。 */
export function applyTailoring(resume: ResumeContent, changes: readonly TailorChange[]): ResumeContent {
  if (changes.length === 0) return resume;
  const rewrites = new Map<string, string>();
  const bulletOrders = new Map<string, string[]>();
  const itemOrders = new Map<string, string[]>();
  let skillOrder: string[] | undefined;
  let summary: string | undefined;
  for (const c of changes) {
    if (c.kind === "bullet") rewrites.set(`${c.itemKey}#${c.sourceHash}`, c.after.trim());
    else if (c.kind === "bullet_order") bulletOrders.set(c.itemKey, c.order);
    else if (c.kind === "item_order") itemOrders.set(c.section, c.after);
    else if (c.kind === "skill_order") skillOrder = c.after;
    else summary = c.after.trim();
  }

  const sections = resume.sections.map((section) => {
    if (section.kind === "skills") {
      return skillOrder ? { ...section, items: orderSkills(section.items, skillOrder) } : section;
    }
    const itemOrder = itemOrders.get(section.kind);
    const items = itemOrder ? sortByOrder(section.items, (i) => i.heading.trim(), itemOrder) : section.items;
    return {
      ...section,
      items: items.map((item) => {
        const itemKey = polishItemKey(section.kind, item.heading);
        const order = bulletOrders.get(itemKey);
        const bullets = order
          ? sortByOrder(item.bullets, (b) => polishSourceHash(b.text), order)
          : item.bullets;
        return {
          ...item,
          bullets: bullets.map((b) => {
            const text = rewrites.get(`${itemKey}#${polishSourceHash(b.text)}`);
            return text ? { ...b, text } : b;
          }),
        };
      }),
    };
  });
  return {
    ...resume,
    basics: summary ? { ...resume.basics, summary } : resume.basics,
    sections,
  };
}

/** 简历里所有可见文字，用来核对定制摘要里的数字和英文词是否有出处。 */
export function resumeText(resume: ResumeContent): string {
  const { basics } = resume;
  return [
    basics.headline,
    basics.summary,
    ...resume.sections.flatMap((s) =>
      s.items.flatMap((item) => [
        item.heading,
        item.subheading,
        item.period,
        ...(item.techStack ?? []),
        ...item.bullets.flatMap((b) => [b.lead, b.text]),
      ]),
    ),
  ]
    .filter(Boolean)
    .join("\n");
}
