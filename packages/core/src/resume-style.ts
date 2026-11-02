import { z } from "zod";

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
});
export type ResumeStyle = z.infer<typeof ResumeStyle>;

export const DEFAULT_RESUME_STYLE: ResumeStyle = { template: "campus", accent: "blue" };

/** 库里或请求里的旧值、坏值一律回落到默认，不让渲染报错。 */
export function resolveResumeStyle(value: unknown): ResumeStyle {
  const raw = (value ?? {}) as Partial<Record<keyof ResumeStyle, unknown>>;
  const template = RESUME_TEMPLATES.find((t) => t === raw.template) ?? DEFAULT_RESUME_STYLE.template;
  const accent = RESUME_ACCENTS.find((a) => a === raw.accent) ?? DEFAULT_RESUME_STYLE.accent;
  return { template, accent };
}
