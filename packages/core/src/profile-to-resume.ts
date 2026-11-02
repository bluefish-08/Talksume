import type { Education, Experience, Profile, Project } from "./profile.ts";
import type { ResumeBullet, ResumeContent, ResumeItem, ResumeSection } from "./resume.ts";

const DEGREE_LABEL: Record<Education["degree"], string> = {
  associate: "专科",
  bachelor: "本科",
  master: "硕士",
  phd: "博士",
};

const SKILL_GROUPS = [
  { level: "expert", heading: "精通" },
  { level: "proficient", heading: "熟练" },
  { level: "familiar", heading: "熟悉" },
  { level: "beginner", heading: "了解" },
  { level: undefined, heading: "其他" },
] as const;

function formatMonth(value: string): string {
  return value.replace("-", ".");
}

function formatPeriod(start?: string, end?: string): string | undefined {
  const from = start ? formatMonth(start) : undefined;
  const to = end === "present" ? "至今" : end ? formatMonth(end) : undefined;
  if (from && to) return `${from} – ${to}`;
  return from ?? to;
}

function chronologicalKey(item: { start?: string | undefined; end?: string | undefined }): string {
  const end = item.end === "present" ? "9999-99" : (item.end ?? item.start ?? "");
  return `${end}|${item.start ?? ""}`;
}

/** 时间倒序；缺时间的排最后，同序保持原顺序。 */
function newestFirst<T extends { start?: string | undefined; end?: string | undefined }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index, key: chronologicalKey(item) }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : a.index - b.index))
    .map((entry) => entry.item);
}

function optional<K extends string>(key: K, value: string | undefined): { [P in K]?: string } {
  return value ? ({ [key]: value } as { [P in K]?: string }) : {};
}

function bullet(text: string | undefined, factIds: string[]): ResumeBullet[] {
  const trimmed = text?.trim();
  return trimmed ? [{ text: trimmed, factIds: [...factIds] }] : [];
}

function stripEnd(text: string | undefined): string {
  return (text ?? "").trim().replace(/[，。；;,.\s]+$/u, "");
}

function joinParts(parts: (string | undefined)[], separator: string): string | undefined {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => !!p);
  return kept.length > 0 ? kept.join(separator) : undefined;
}

function educationItem(edu: Education): ResumeItem {
  const course = edu.courses.length > 0 ? `核心课程：${edu.courses.join("、")}` : undefined;
  return {
    heading: edu.school,
    ...optional("subheading", joinParts([edu.major, DEGREE_LABEL[edu.degree]], " ")),
    ...optional("period", formatPeriod(edu.start, edu.end)),
    bullets: [
      ...bullet(edu.gpa ? `GPA ${edu.gpa}` : undefined, edu.sourceFactIds),
      ...bullet(course, edu.sourceFactIds),
    ],
  };
}

function experienceItem(exp: Experience): ResumeItem {
  return {
    heading: exp.company,
    ...optional("subheading", exp.title.trim() || undefined),
    ...optional("period", formatPeriod(exp.start, exp.end)),
    bullets: exp.bullets.flatMap((text) => bullet(text, exp.sourceFactIds)),
  };
}

/** STAR 压成至多三条：背景与任务、行动、结果。 */
function projectItem(project: Project): ResumeItem {
  const ids = project.sourceFactIds;
  const context = joinParts([stripEnd(project.situation), stripEnd(project.task)], "，");
  return {
    heading: project.name,
    ...optional("subheading", joinParts([project.role, project.techStack.join(" / ")], " · ")),
    ...optional("period", formatPeriod(project.start, project.end)),
    bullets: [...bullet(context, ids), ...bullet(project.action, ids), ...bullet(project.result, ids)],
  };
}

function experienceTitle(experiences: Experience[]): string {
  const internships = experiences.filter((e) => e.kind === "internship").length;
  if (internships === experiences.length) return "实习经历";
  return internships === 0 ? "工作经历" : "实习与工作经历";
}

/** 每个熟练度一个条目；全部没有熟练度时不加前缀，避免只剩一个「其他」。 */
function skillItems(skills: Profile["skills"]): ResumeItem[] {
  const groups = SKILL_GROUPS.map(({ level, heading }) => ({
    heading,
    group: skills.filter((s) => s.level === level),
  })).filter(({ group }) => group.length > 0);
  const onlyUnleveled = groups.length === 1 && groups[0]?.heading === "其他";
  return groups.map(({ heading, group }) => ({
    heading: onlyUnleveled ? "" : heading,
    bullets: [
      {
        text: group.map((s) => s.name).join("、"),
        factIds: [...new Set(group.flatMap((s) => s.sourceFactIds))],
      },
    ],
  }));
}

/** 技能条目在各处统一渲染成一行：「熟悉：Go、MySQL」；无标题时只有内容。 */
export function skillLine(item: ResumeItem): { label: string; text: string } {
  return { label: item.heading.trim(), text: item.bullets.map((b) => b.text).join("；") };
}

/** 画像到简历内容的确定性映射，不调用模型；用于实时预览和导出。 */
export function profileToResume(profile: Profile): ResumeContent {
  const { basics } = profile;
  const sections: ResumeSection[] = [];
  const add = (section: ResumeSection) => {
    if (section.items.length > 0) sections.push(section);
  };

  add({ kind: "education", title: "教育背景", items: newestFirst(profile.education).map(educationItem) });
  add({
    kind: "experiences",
    title: experienceTitle(profile.experiences),
    items: newestFirst(profile.experiences).map(experienceItem),
  });
  add({ kind: "projects", title: "项目经历", items: newestFirst(profile.projects).map(projectItem) });
  add({ kind: "skills", title: "专业技能", items: skillItems(profile.skills) });
  add({
    kind: "awards",
    title: "获奖荣誉",
    items: [...profile.awards]
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .map((award) => ({
        heading: award.name,
        ...optional("period", award.date && formatMonth(award.date)),
        bullets: bullet(award.description, award.sourceFactIds),
      })),
  });

  const contacts = [basics.phone, basics.email, basics.city].filter((c): c is string => !!c?.trim());
  return {
    basics: {
      name: basics.name?.trim() ?? "",
      contacts,
      ...(basics.summary?.trim() && { summary: basics.summary.trim() }),
    },
    sections,
  };
}
