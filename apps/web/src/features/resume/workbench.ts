import type { Completeness, ProfileSection, ResumeContent } from "../../api/types.ts";
import { relativeTime } from "../applications/format.ts";
import { missingText } from "./resumeUtils.ts";

export interface ResumeSuggestion {
  key: string;
  title: string;
  /** 点击后发给右侧对话的消息。 */
  prompt: string;
}

const SECTION_NAMES: Record<ProfileSection, string> = {
  basics: "基本信息",
  education: "教育经历",
  experiences: "实习经历",
  projects: "项目经历",
  skills: "专业技能",
  awards: "获奖荣誉",
  intention: "求职意向",
};

const ITEM_KIND = { experiences: "实习", projects: "项目", campus: "校园" } as const;
const THIN_BULLETS = 3;
const HAS_NUMBER = /\d/;

/** 还没问到的必填字段；缺整段、缺条目的已经在短板里。 */
function missingSuggestions(completeness: Completeness | undefined): ResumeSuggestion[] {
  if (!completeness) return [];
  const done = new Set(completeness.sections.filter((s) => s.completed).map((s) => s.section));
  const groups = new Map<string, { section: ProfileSection; item?: string; labels: string[] }>();
  for (const m of completeness.missing) {
    if (!m.required || m.kind === "quantify" || m.kind === "new_item" || m.kind === "probe") continue;
    if (done.has(m.section)) continue;
    const key = `${m.section}|${m.itemId ?? ""}`;
    const group = groups.get(key) ?? {
      section: m.section,
      ...(m.itemLabel && { item: m.itemLabel }),
      labels: [],
    };
    groups.set(key, group);
    const label = m.label.replace(/（.*?）/, "");
    if (!group.labels.includes(label)) group.labels.push(label);
  }
  return [...groups].map(([key, g]) => {
    const target = g.item ? `「${g.item}」` : SECTION_NAMES[g.section];
    const fields = g.labels.join("、");
    return {
      key: `missing:${key}`,
      title: `${target}还缺${fields}`,
      prompt: `帮我补充${target}的${fields}，请一项一项问我。`,
    };
  });
}

function gapSuggestions(completeness: Completeness | undefined): ResumeSuggestion[] {
  return (completeness?.gaps ?? []).map((g) => ({
    key: `gap:${g.key}`,
    title: `还缺${g.label}`,
    prompt: g.prompt,
  }));
}

function thinItemSuggestions(resume: ResumeContent): ResumeSuggestion[] {
  return resume.sections.flatMap((section) => {
    if (section.kind !== "experiences" && section.kind !== "projects" && section.kind !== "campus") return [];
    const kind = ITEM_KIND[section.kind];
    return section.items.flatMap((item, i) => {
      const count = item.bullets.length;
      // 一条要点都没有的已经在短板里
      if (count === 0) return [];
      const quantified = item.bullets.some((b) => HAS_NUMBER.test(b.text));
      if (count >= THIN_BULLETS && quantified) return [];
      const problems = [
        count === 0 ? "还没有要点" : count < THIN_BULLETS ? `只有 ${count} 条要点` : "",
        count > 0 && !quantified ? "没有量化结果" : "",
      ].filter(Boolean);
      const name = `${item.heading}${kind}`;
      return [
        {
          key: `thin:${section.kind}:${i}`,
          title: `${name}${problems.join("，")}`,
          prompt: `帮我完善「${item.heading}」这段${kind}经历：目前${problems.join("，")}。请追问我具体做了什么、用了什么方法、带来了什么可量化的效果。`,
        },
      ];
    });
  });
}

/** 「还可以补充」：先列简历短板，再列还没问到的必填项，最后是要点少或没量化的经历。 */
export function resumeSuggestions(
  resume: ResumeContent,
  completeness: Completeness | undefined,
  limit = 4,
): ResumeSuggestion[] {
  return [
    ...gapSuggestions(completeness),
    ...missingSuggestions(completeness),
    ...thinItemSuggestions(resume),
  ].slice(0, limit);
}

/** 对话面板为空时的快捷提示，尽量带上简历里的真实条目名。 */
export function quickPrompts(resume: ResumeContent | undefined, role: string | undefined): string[] {
  const items = (kind: "experiences" | "projects" | "skills") =>
    resume?.sections.find((s) => s.kind === kind)?.items ?? [];
  const projects = items("projects");
  const experiences = items("experiences");
  const hasSkills = items("skills").length > 0;
  if (projects.length + experiences.length === 0 && !hasSkills) {
    return ["我想聊聊一段实习经历", "帮我整理一个课程项目", "说说我的求职意向"];
  }
  const project =
    projects.find((p) => !p.bullets.some((b) => HAS_NUMBER.test(b.text))) ?? projects[0] ?? experiences[0];
  return [
    project ? `帮我补充${project.heading}的量化结果` : "帮我补充一个项目经历",
    hasSkills ? `补充${role || "目标"}岗位用得上的技能` : "帮我整理专业技能",
    experiences[0] ? `细说${experiences[0].heading}实习的成果` : "我想聊聊一段实习经历",
  ];
}

export function resumeSubtitle(
  score: number,
  updatedAt: string | null | undefined,
  now = Date.now(),
): string {
  const parts = [`完整度 ${Math.round(score * 100)}%`];
  const when = updatedAt ? relativeTime(updatedAt, now) : "";
  if (when) parts.push(`${when}${/\d$/.test(when) ? " " : ""}更新`);
  return parts.join(" · ");
}

/** 副标题里「还缺什么」的提示，点击后按最要紧的那个短板去问；没有短板就不提示。 */
export function missingPrompt(
  completeness: Completeness | undefined,
): { text: string; prompt: string } | null {
  const text = missingText(completeness);
  const first = completeness?.gaps?.[0];
  return text && first ? { text, prompt: first.prompt } : null;
}

export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

export function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {}
}

export const PAPER_WIDTH_PX = (210 / 25.4) * 96;
export const PAPER_HEIGHT_PX = (297 / 25.4) * 96;
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 150;
const ZOOM_STEP = 10;

/** 适合页面 / 适合宽度，或固定百分比。 */
export type ZoomMode = "page" | "width" | number;

export function parseZoom(raw: string | null, fallback: ZoomMode = "page"): ZoomMode {
  if (raw === "page" || raw === "width") return raw;
  const n = Number(raw);
  return raw !== null && Number.isInteger(n) && n >= ZOOM_MIN && n <= ZOOM_MAX ? n : fallback;
}

export function readZoom(key: string, fallback: ZoomMode = "page"): ZoomMode {
  try {
    return parseZoom(localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

export function writeZoom(key: string, value: ZoomMode): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

/** 适配类档位不放大到超过 100%；视口还没量出来（0）时按 100% 渲染。 */
export function paperScale(mode: ZoomMode, viewport: { width: number; height: number }): number {
  if (typeof mode === "number") return mode / 100;
  const byWidth = viewport.width > 0 ? viewport.width / PAPER_WIDTH_PX : 1;
  const byHeight = viewport.height > 0 ? viewport.height / PAPER_HEIGHT_PX : 1;
  return Math.min(1, mode === "page" ? Math.min(byWidth, byHeight) : byWidth);
}

/** 从当前实际缩放出发按 10% 一档增减，结果落在整十百分比上。 */
export function stepZoom(scale: number, direction: 1 | -1): number {
  const pct = Math.round(scale * 100);
  const next =
    direction > 0
      ? Math.floor(pct / ZOOM_STEP) * ZOOM_STEP + ZOOM_STEP
      : Math.ceil(pct / ZOOM_STEP) * ZOOM_STEP - ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}
