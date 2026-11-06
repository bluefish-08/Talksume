import { z } from "zod";
import { CSS_LIMITS, sanitizeResumeCss } from "./resume-css.ts";
import { hue, ResumeTheme, type ResumeThemePatch, sanitizeTheme } from "./resume-theme.ts";

export const RESUME_TEMPLATES = ["campus", "modern", "minimal", "tech"] as const;
export const RESUME_ACCENTS = ["blue", "teal", "wine", "ink"] as const;

export type ResumeTemplate = (typeof RESUME_TEMPLATES)[number];
export type ResumeAccent = (typeof RESUME_ACCENTS)[number];

export const TEMPLATE_INFO: Record<ResumeTemplate, { label: string; hint: string }> = {
  campus: { label: "经典校园", hint: "居中抬头、色标题配通栏细线，校招通用" },
  modern: { label: "现代强调色", hint: "抬头色块、分区色条，适合产品、运营、设计" },
  minimal: { label: "极简黑白", hint: "全黑白灰、细线条，适合外企与打印" },
  tech: { label: "技术紧凑", hint: "侧栏标题、技能标签、行距紧凑，适合技术岗" },
};

/** 极简黑白不用强调色，选了也不生效。 */
export const templateUsesAccent = (template: ResumeTemplate): boolean => template !== "minimal";

export const ACCENT_INFO: Record<ResumeAccent, { label: string; hex: string }> = {
  blue: { label: "品牌蓝", hex: "#2563eb" },
  teal: { label: "青绿", hex: "#0f766e" },
  wine: { label: "酒红", hex: "#9f1239" },
  ink: { label: "墨黑", hex: "#1f2937" },
};

export const ResumeStyle = z.object({
  template: z.enum(RESUME_TEMPLATES),
  accent: z.enum(RESUME_ACCENTS),
  /** 对话里定制的主题；template/accent 同时存着最接近的预设，主题失效或 HR 快照时用它。 */
  theme: ResumeTheme.optional(),
  /** 经 sanitizeResumeCss 规范化的定制 CSS，叠在主题（或预设）之上。 */
  css: z.string().max(CSS_LIMITS.maxChars).optional(),
});
export type ResumeStyle = z.infer<typeof ResumeStyle>;

export const DEFAULT_RESUME_STYLE: ResumeStyle = { template: "campus", accent: "blue" };

/** 库里或请求里的旧值、坏值一律回落到默认，不让渲染报错。 */
export function resolveResumeStyle(value: unknown): ResumeStyle {
  const raw = (value ?? {}) as Partial<Record<keyof ResumeStyle, unknown>>;
  const template = RESUME_TEMPLATES.find((t) => t === raw.template) ?? DEFAULT_RESUME_STYLE.template;
  const accent = RESUME_ACCENTS.find((a) => a === raw.accent) ?? DEFAULT_RESUME_STYLE.accent;
  const theme = raw.theme === undefined ? null : sanitizeTheme(raw.theme)?.theme;
  const css = typeof raw.css === "string" ? sanitizeResumeCss(raw.css) : undefined;
  return {
    template,
    accent,
    ...(theme && { theme }),
    ...(css?.ok && { css: css.css }),
  };
}

/** 保存定制 CSS：校验不过返回错误列表，样式不变。 */
export function applyCustomCss(
  current: ResumeStyle,
  input: string,
): { ok: true; style: ResumeStyle; rules: number; dropped: string[] } | { ok: false; errors: string[] } {
  const result = sanitizeResumeCss(input);
  if (!result.ok) return result;
  return { ok: true, style: { ...current, css: result.css }, rules: result.rules, dropped: result.dropped };
}

export function clearCustomCss(current: ResumeStyle): ResumeStyle {
  const { css: _css, ...rest } = current;
  return rest;
}

const PRESET_THEMES: Record<ResumeTemplate, Omit<ResumeTheme, "name" | "accent">> = {
  campus: {
    bodyFont: "sans",
    headingFont: "sans",
    header: "plain",
    headerAlign: "center",
    headingStyle: "underline",
    layout: "single",
    bullet: "dot",
    skills: "line",
    density: "auto",
  },
  modern: {
    bodyFont: "sans",
    headingFont: "sans",
    header: "band",
    headerAlign: "left",
    headingStyle: "bar",
    layout: "single",
    bullet: "square",
    skills: "line",
    density: "auto",
  },
  minimal: {
    bodyFont: "sans",
    headingFont: "serif",
    header: "rule",
    headerAlign: "left",
    headingStyle: "plain",
    layout: "single",
    bullet: "dash",
    skills: "line",
    density: "auto",
  },
  tech: {
    bodyFont: "sans",
    headingFont: "sans",
    header: "rule",
    headerAlign: "left",
    headingStyle: "plain",
    layout: "single",
    bullet: "dot",
    skills: "tags",
    density: "auto",
  },
};

/** 还没有主题时，从当前预设推出一个起点，对话里的增量修改合并在它上面。 */
export function themeFromPreset(style: ResumeStyle): ResumeTheme {
  if (style.theme) return style.theme;
  const accent = templateUsesAccent(style.template) ? ACCENT_INFO[style.accent].hex : "#111111";
  return { name: TEMPLATE_INFO[style.template].label, accent, ...PRESET_THEMES[style.template] };
}

function nearestAccent(hex: string): ResumeAccent {
  const { h, s, l } = hue(hex);
  // 按色度而不是饱和度判断，深灰蓝（墨黑 #1f2937）的 HSL 饱和度并不低
  if (s * (1 - Math.abs(2 * l - 1)) < 0.12) return "ink";
  const dist = (a: ResumeAccent) => {
    const d = Math.abs(hue(ACCENT_INFO[a].hex).h - h);
    return Math.min(d, 360 - d);
  };
  return (["blue", "teal", "wine"] as const).reduce((best, a) => (dist(a) < dist(best) ? a : best));
}

/** 主题对应的最接近预设：投递快照、DOCX 版式和主题失效时的回退。 */
export function fallbackPreset(theme: ResumeTheme): Omit<ResumeStyle, "theme"> {
  const accent = nearestAccent(theme.accent);
  const template: ResumeTemplate =
    theme.layout === "sidebar" || theme.skills === "tags"
      ? "tech"
      : theme.header === "band"
        ? "modern"
        : theme.headingFont === "serif" && accent === "ink"
          ? "minimal"
          : "campus";
  return { template, accent };
}

export interface ThemeChange {
  style: ResumeStyle;
  notes: string[];
}

/** 增量修改合并到当前样式上；没有主题时以当前预设为起点。合并后不合法返回 null。 */
export function applyThemePatch(current: ResumeStyle, patch: ResumeThemePatch): ThemeChange | null {
  const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const name = patch.name ?? current.theme?.name ?? "我的定制";
  const sanitized = sanitizeTheme({ ...themeFromPreset(current), ...changes, name });
  if (!sanitized) return null;
  const { theme, notes } = sanitized;
  return { style: { ...fallbackPreset(theme), theme, ...(current.css && { css: current.css }) }, notes };
}
