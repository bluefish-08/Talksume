import type { Completeness, ProfileSection, ResumeContent } from "../../api/types.ts";
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
    return title && kind && !present.has(kind) && !s.completed && s.score < 1 ? [title] : [];
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

const MISSING_LIMIT = 3;

/** 简历本身的短板，用户跳过、说没有的照样算缺。 */
export function missingText(completeness: Completeness | undefined): string {
  const labels = (completeness?.gaps ?? []).map((g) => g.label);
  if (labels.length === 0) return "";
  return `还缺${labels.slice(0, MISSING_LIMIT).join("、")}${labels.length > MISSING_LIMIT ? "等" : ""}`;
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

const READY_SCORE = 0.85;

/** 没有短板、充实度够高才算完成；问完了但内容单薄的简历不算。 */
export function isResumeComplete(completeness: Completeness | undefined): boolean {
  return !!completeness && (completeness.gaps?.length ?? 0) === 0 && completeness.score >= READY_SCORE;
}

export function matchesLabel(total: number | undefined): string {
  return total ? `看看推荐岗位（${total} 个匹配）` : "看看推荐岗位";
}
