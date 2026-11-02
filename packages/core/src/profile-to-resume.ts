import type { Education, Experience, Highlight, JobType, Profile, Project, Skill } from "./profile.ts";
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

function highlightBullets(highlights: Highlight[] | undefined, factIds: string[]): ResumeBullet[] {
  return (highlights ?? []).flatMap((h) => {
    const lead = h.title?.trim();
    return bullet(h.detail, factIds).map((b) => (lead ? { lead, ...b } : b));
  });
}

function rankText(rank: string | undefined): string | undefined {
  const trimmed = rank?.trim();
  if (!trimmed) return undefined;
  return /排名|前|top/i.test(trimmed) ? trimmed : `排名 ${trimmed}`;
}

/** 成绩、外语一行，课程、荣誉各一行；外语只挂在最近一段教育上。 */
function educationItem(edu: Education, languages: string[]): ResumeItem {
  const ids = edu.sourceFactIds;
  const rank = rankText(edu.rank);
  const score = edu.gpa?.trim() ? `GPA ${edu.gpa.trim()}${rank ? `（${rank}）` : ""}` : rank;
  const honors = (edu.honors ?? []).map((h) => h.trim()).filter(Boolean);
  return {
    heading: edu.school,
    ...optional("subheading", joinParts([edu.major, DEGREE_LABEL[edu.degree]], " · ")),
    ...optional("period", formatPeriod(edu.start, edu.end)),
    ...optional("meta", edu.city?.trim()),
    bullets: [
      ...bullet(joinParts([score, languages.join("，")], "，"), ids),
      ...(edu.courses.length > 0
        ? [{ lead: "主修课程", text: edu.courses.join("、"), factIds: [...ids] }]
        : []),
      ...(honors.length > 0 ? [{ lead: "荣誉奖项", text: honors.join("、"), factIds: [...ids] }] : []),
    ],
  };
}

function stackOf(techStack: string[] | undefined): { techStack?: string[] } {
  const stack = (techStack ?? []).map((t) => t.trim()).filter(Boolean);
  return stack.length > 0 ? { techStack: stack } : {};
}

function experienceItem(exp: Experience): ResumeItem {
  const highlights = highlightBullets(exp.highlights, exp.sourceFactIds);
  return {
    heading: exp.company,
    ...optional("subheading", joinParts([exp.department, exp.title], " · ")),
    ...optional("period", formatPeriod(exp.start, exp.end)),
    ...optional("meta", exp.city?.trim()),
    ...stackOf(exp.techStack),
    bullets:
      highlights.length > 0 ? highlights : exp.bullets.flatMap((text) => bullet(text, exp.sourceFactIds)),
  };
}

/** 没有 highlights 时 STAR 压成至多三条：背景与任务、行动、结果；文字保持不变，已采用的润色才能继续命中。 */
function projectItem(project: Project): ResumeItem {
  const ids = project.sourceFactIds;
  const highlights = highlightBullets(project.highlights, ids);
  const context = joinParts([stripEnd(project.situation), stripEnd(project.task)], "，");
  return {
    heading: project.name,
    ...optional("subheading", project.role?.trim()),
    ...optional("period", formatPeriod(project.start, project.end)),
    ...optional("meta", project.city?.trim()),
    ...stackOf(project.techStack),
    bullets:
      highlights.length > 0
        ? highlights
        : [...bullet(context, ids), ...bullet(project.action, ids), ...bullet(project.result, ids)],
  };
}

function experienceTitle(experiences: Experience[]): string {
  const internships = experiences.filter((e) => e.kind === "internship").length;
  if (internships === experiences.length) return "实习经历";
  return internships === 0 ? "工作经历" : "实习与工作经历";
}

const factIdsOf = (skills: Skill[]) => [...new Set(skills.flatMap((s) => s.sourceFactIds))];
const namesOf = (skills: Skill[]) => skills.map((s) => s.name).join("、");

/** 同一分组内按熟练度分段：「熟练 Java、Go；了解 Rust」，没写熟练度的放最后。 */
function categoryBullets(skills: Skill[]): ResumeBullet[] {
  if (skills.every((s) => !s.level)) return [{ text: namesOf(skills), factIds: factIdsOf(skills) }];
  return SKILL_GROUPS.flatMap(({ level, heading }) => {
    const group = skills.filter((s) => s.level === level);
    if (group.length === 0) return [];
    const lead = level ? { lead: heading } : {};
    return [{ ...lead, text: namesOf(group), factIds: factIdsOf(group) }];
  });
}

/** 有分组时按分组出条目（未分组的归「其他」），否则每个熟练度一个条目；全部没有熟练度时不加前缀。 */
function skillItems(skills: Profile["skills"]): ResumeItem[] {
  if (skills.some((s) => s.category?.trim())) {
    const categories = new Map<string, Skill[]>();
    for (const skill of skills) {
      const key = skill.category?.trim() || "其他";
      categories.set(key, [...(categories.get(key) ?? []), skill]);
    }
    const other = categories.get("其他");
    if (other) {
      categories.delete("其他");
      categories.set("其他", other);
    }
    return [...categories].map(([heading, group]) => ({ heading, bullets: categoryBullets(group) }));
  }
  const groups = SKILL_GROUPS.map(({ level, heading }) => ({
    heading,
    group: skills.filter((s) => s.level === level),
  })).filter(({ group }) => group.length > 0);
  const onlyUnleveled = groups.length === 1 && groups[0]?.heading === "其他";
  return groups.map(({ heading, group }) => ({
    heading: onlyUnleveled ? "" : heading,
    bullets: [{ text: namesOf(group), factIds: factIdsOf(group) }],
  }));
}

/** 技能条目在各处统一渲染成一行：「熟悉：Go、MySQL」「后端：熟练 Java；了解 Go」；无标题时只有内容。 */
export function skillLine(item: ResumeItem): { label: string; text: string } {
  return {
    label: item.heading.trim(),
    text: item.bullets.map((b) => (b.lead ? `${b.lead} ${b.text}` : b.text)).join("；"),
  };
}

const JOB_TYPE_LABEL: Record<JobType, string> = { internship: "实习", campus: "校招", experienced: "社招" };

const MAX_HEADLINE_ROLES = 2;

const thousands = (yuan: number) => `${Number((yuan / 1000).toFixed(1))}k`;

function salaryText({ salaryMin: min, salaryMax: max }: Profile["intention"]): string | undefined {
  if (min && max) return `期望月薪 ${thousands(min)}–${thousands(max)}`;
  if (min) return `期望月薪 ${thousands(min)} 起`;
  if (max) return `期望月薪 ${thousands(max)} 以内`;
  return undefined;
}

/**
 * 「2026 届 · 后端开发 · 实习 · 意向城市：杭州 / 上海 · 可于 2026.07 到岗」；
 * 届别取最近一段已写明毕业年月的教育，社招不写；没有任何意向时不出这一行；薪资要显式打开才写。
 */
function deriveHeadline(profile: Profile): string | undefined {
  const { intention } = profile;
  const roles = intention.roles.map((r) => r.trim()).filter(Boolean);
  const cities = intention.cities.map((c) => c.trim()).filter(Boolean);
  const salary = intention.showSalary ? salaryText(intention) : undefined;
  const parts = [
    roles.slice(0, MAX_HEADLINE_ROLES).join(" / "),
    intention.jobType && JOB_TYPE_LABEL[intention.jobType],
    cities.length > 0 ? `意向城市：${cities.join(" / ")}` : undefined,
    intention.availableFrom && `可于 ${formatMonth(intention.availableFrom)} 到岗`,
    salary,
  ];
  if (!joinParts(parts, "")) return undefined;
  const graduation = newestFirst(profile.education).find((e) => e.end && e.end !== "present")?.end;
  const cohort =
    graduation && intention.jobType !== "experienced" ? `${graduation.slice(0, 4)} 届` : undefined;
  return joinParts([cohort, ...parts], " · ");
}

/** 画像到简历内容的确定性映射，不调用模型；用于实时预览和导出。 */
export function profileToResume(profile: Profile): ResumeContent {
  const { basics } = profile;
  const sections: ResumeSection[] = [];
  const add = (section: ResumeSection) => {
    if (section.items.length > 0) sections.push(section);
  };

  const languages = (basics.languages ?? []).map((l) => l.trim()).filter(Boolean);
  const education = newestFirst(profile.education).map((edu, i) =>
    educationItem(edu, i === 0 ? languages : []),
  );
  const skills = skillItems(profile.skills);
  if (education.length === 0 && languages.length > 0) {
    skills.push({ heading: "语言能力", bullets: [{ text: languages.join("，"), factIds: [] }] });
  }
  add({ kind: "education", title: "教育背景", items: education });
  add({
    kind: "experiences",
    title: experienceTitle(profile.experiences),
    items: newestFirst(profile.experiences).map(experienceItem),
  });
  add({ kind: "projects", title: "项目经历", items: newestFirst(profile.projects).map(projectItem) });
  add({ kind: "skills", title: "专业技能", items: skills });
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

  const contacts = [basics.city, basics.phone, basics.email]
    .map((c) => c?.trim())
    .filter((c): c is string => !!c);
  const links = (basics.links ?? []).flatMap(({ label, url }) =>
    url.trim() ? [{ ...(label?.trim() && { label: label.trim() }), url: url.trim() }] : [],
  );
  const headline = basics.headline?.trim() || deriveHeadline(profile);
  return {
    basics: {
      name: basics.name?.trim() ?? "",
      ...(headline && { headline }),
      contacts,
      ...(links.length > 0 && { links }),
      ...(basics.photo?.trim() && { photo: basics.photo.trim() }),
      ...(basics.summary?.trim() && { summary: basics.summary.trim() }),
    },
    sections,
  };
}
