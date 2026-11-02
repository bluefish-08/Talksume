import type { Completeness, MissingField, ProfileSection, ResumeContent } from "../../api/types.ts";
import type { FactItem } from "./queries.ts";
import type { FactQuote } from "./ResumePreview.tsx";

const PLACEHOLDER_TITLES: Partial<Record<ProfileSection, string>> = {
  education: "教育背景",
  experiences: "实习经历",
  projects: "项目经历",
  skills: "专业技能",
  awards: "获奖荣誉",
};

const KIND_OF: Partial<Record<ProfileSection, ResumeContent["sections"][number]["kind"]>> = {
  education: "education",
  experiences: "experiences",
  projects: "projects",
  skills: "skills",
  awards: "awards",
};

/** 简历里还没出现的分区，用占位条提示“这里还会有内容”。 */
export function placeholderTitles(resume: ResumeContent, completeness: Completeness | undefined): string[] {
  if (!completeness) return [];
  const present = new Set(resume.sections.map((s) => s.kind));
  return completeness.sections.flatMap((s) => {
    const title = PLACEHOLDER_TITLES[s.section];
    const kind = KIND_OF[s.section];
    return title && kind && !present.has(kind) && s.score < 1 ? [title] : [];
  });
}

/** 新简历相对旧简历多出来的条目标题和要点原文。 */
export function diffAdded(before: ResumeContent, after: ResumeContent): Set<string> {
  const oldHeadings = new Set<string>();
  const oldBullets = new Set<string>();
  for (const section of before.sections) {
    for (const item of section.items) {
      oldHeadings.add(`${section.kind}|${item.heading}`);
      for (const b of item.bullets) oldBullets.add(`${section.kind}|${item.heading}|${b.text}`);
    }
  }
  const added = new Set<string>();
  for (const section of after.sections) {
    for (const item of section.items) {
      if (!oldHeadings.has(`${section.kind}|${item.heading}`)) added.add(item.heading);
      for (const b of item.bullets) {
        if (!oldBullets.has(`${section.kind}|${item.heading}|${b.text}`)) added.add(b.text);
      }
    }
  }
  return added;
}

const SECTION_TITLES: Record<ProfileSection, string> = {
  basics: "基本信息",
  education: "教育经历",
  experiences: "实习经历",
  projects: "项目经历",
  skills: "技能",
  awards: "获奖荣誉",
  intention: "求职意向",
};

const MISSING_LIMIT = 4;

/** 基本信息、求职意向的字段名自带语境，直接列；列表型分区合并成「项目经历的角色、结果」。 */
export function missingText(completeness: Completeness | undefined): string {
  if (!completeness) return "";
  const done = new Set(completeness.sections.filter((s) => s.completed).map((s) => s.section));
  const labels: string[] = [];
  const nested = new Map<ProfileSection, string[]>();
  const push = (list: string[], label: string) => {
    if (!list.includes(label)) list.push(label);
  };
  for (const m of completeness.missing) {
    if (!m.required || m.kind === "quantify" || done.has(m.section)) continue;
    if (m.kind === "new_item") push(labels, SECTION_TITLES[m.section]);
    else if (m.section === "basics" || m.section === "intention") push(labels, m.label);
    else {
      const fields = nested.get(m.section) ?? [];
      nested.set(m.section, fields);
      push(fields, m.label.replace(/（.*?）/, ""));
    }
  }
  for (const [section, fields] of nested) {
    if (!labels.includes(SECTION_TITLES[section]))
      labels.push(`${SECTION_TITLES[section]}的${fields.join("、")}`);
  }
  if (labels.length === 0) return "";
  return `还差${labels.slice(0, MISSING_LIMIT).join("、")}${labels.length > MISSING_LIMIT ? "等" : ""}`;
}

export function factQuotes(
  facts: readonly FactItem[] | undefined,
  roundOf?: (messageId: string) => number | undefined,
): Record<string, FactQuote> {
  const out: Record<string, FactQuote> = {};
  for (const f of facts ?? []) {
    if (f.status === "superseded" || !f.quote) continue;
    const round = f.sourceMessageId ? roundOf?.(f.sourceMessageId) : undefined;
    out[f.id] = round ? { quote: f.quote, round } : { quote: f.quote };
  }
  return out;
}

export function isResumeComplete(completeness: Completeness | undefined): boolean {
  return !!completeness && Math.round(completeness.score * 100) >= 100;
}

export function matchesLabel(total: number | undefined): string {
  return total ? `看看推荐岗位（${total} 个匹配）` : "看看推荐岗位";
}
