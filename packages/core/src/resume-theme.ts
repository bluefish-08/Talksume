import { z } from "zod";

// 主题只放枚举和 6 位 hex：CSS 全由渲染代码按字段拼出，生成内容进不了样式表
export const HexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "颜色必须是 #rrggbb 形式的 6 位十六进制")
  .transform((v) => v.toLowerCase());

export const THEME_FONTS = ["sans", "serif"] as const;
export const THEME_HEADERS = ["plain", "rule", "band"] as const;
export const THEME_ALIGNS = ["left", "center"] as const;
export const THEME_HEADINGS = ["underline", "bar", "block", "plain"] as const;
export const THEME_LAYOUTS = ["single", "sidebar"] as const;
export const THEME_BULLETS = ["dot", "square", "dash"] as const;
export const THEME_SKILLS = ["line", "tags"] as const;
export const THEME_DENSITIES = ["auto", "roomy", "normal", "compact"] as const;

export const ResumeTheme = z
  .object({
    name: z.string().trim().min(1).max(12),
    accent: HexColor,
    headingColor: HexColor.optional(),
    bodyFont: z.enum(THEME_FONTS),
    headingFont: z.enum(THEME_FONTS),
    header: z.enum(THEME_HEADERS),
    headerAlign: z.enum(THEME_ALIGNS),
    headingStyle: z.enum(THEME_HEADINGS),
    layout: z.enum(THEME_LAYOUTS),
    bullet: z.enum(THEME_BULLETS),
    skills: z.enum(THEME_SKILLS),
    density: z.enum(THEME_DENSITIES),
  })
  .strict();
export type ResumeTheme = z.infer<typeof ResumeTheme>;

export const ResumeThemePatch = ResumeTheme.partial().strict();
export type ResumeThemePatch = z.infer<typeof ResumeThemePatch>;

export const THEME_LABELS = {
  bodyFont: { sans: "正文黑体", serif: "正文宋体" },
  headingFont: { sans: "标题黑体", serif: "标题宋体" },
  header: { plain: "抬头无装饰", rule: "抬头底部细线", band: "抬头主色色块" },
  headerAlign: { left: "抬头左对齐", center: "抬头居中" },
  headingStyle: {
    underline: "分区标题下划线",
    bar: "分区标题左侧色条",
    block: "分区标题色块",
    plain: "分区标题只变色",
  },
  layout: { single: "单栏", sidebar: "两栏（左栏放教育、技能、奖项）" },
  bullet: { dot: "圆点符号", square: "方块符号", dash: "短横符号" },
  skills: { line: "技能文字行", tags: "技能标签" },
  density: { auto: "疏密自动适配一页", roomy: "宽松", normal: "标准疏密", compact: "紧凑" },
} as const;

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: readonly number[]) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 和白色的对比度，1～21。 */
export const contrastOnWhite = (hex: string): number => 1.05 / (luminance(hex) + 0.05);

/** 文字色和白字底色都按 WCAG AA 正文级。 */
export const MIN_CONTRAST = 4.5;

export function darkenToContrast(hex: string, min = MIN_CONTRAST): string {
  const rgb = channels(hex);
  let out = hex;
  for (let t = 0; contrastOnWhite(out) < min && t < 1; t += 0.04) out = toHex(rgb.map((c) => c * (1 - t)));
  return contrastOnWhite(out) < min ? "#000000" : out;
}

export function hue(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = channels(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

const HUE_NAMES: [number, string][] = [
  [15, "红"],
  [40, "橙"],
  [65, "黄"],
  [160, "绿"],
  [195, "青"],
  [255, "蓝"],
  [290, "紫"],
  [335, "粉"],
  [360, "红"],
];

export function colorName(hex: string): string {
  const { h, s, l } = hue(hex);
  if (s < 0.15) return l < 0.25 ? "墨黑" : "灰";
  const name = HUE_NAMES.find(([end]) => h < end)?.[1] ?? "红";
  return `${l < 0.3 ? "深" : l > 0.65 ? "浅" : ""}${name}`;
}

export interface SanitizedTheme {
  theme: ResumeTheme;
  /** 给模型和用户看的自动调整说明。 */
  notes: string[];
}

/** 校验 + 归一化：不合法返回 null；颜色太浅自动加深到打印可读。 */
export function sanitizeTheme(input: unknown): SanitizedTheme | null {
  const parsed = ResumeTheme.safeParse(input);
  if (!parsed.success) return null;
  const theme = { ...parsed.data };
  const notes: string[] = [];
  for (const key of ["accent", "headingColor"] as const) {
    const value = theme[key];
    if (!value) continue;
    const fixed = darkenToContrast(value);
    if (fixed !== value) {
      notes.push(
        `${key === "accent" ? "主色" : "标题色"} ${value} 在白纸上太浅，打印看不清，已加深为 ${fixed}`,
      );
      theme[key] = fixed;
    }
  }
  if (theme.headingColor === theme.accent) delete theme.headingColor;
  return { theme, notes };
}

export function describeTheme(theme: ResumeTheme): string {
  const heading = theme.headingColor ?? theme.accent;
  return [
    `「${theme.name}」`,
    `主色${colorName(theme.accent)} ${theme.accent}`,
    heading !== theme.accent ? `标题色${colorName(heading)} ${heading}` : "",
    THEME_LABELS.layout[theme.layout],
    THEME_LABELS.headingFont[theme.headingFont],
    THEME_LABELS.bodyFont[theme.bodyFont],
    THEME_LABELS.header[theme.header],
    THEME_LABELS.headerAlign[theme.headerAlign],
    THEME_LABELS.headingStyle[theme.headingStyle],
    THEME_LABELS.bullet[theme.bullet],
    THEME_LABELS.skills[theme.skills],
    THEME_LABELS.density[theme.density],
  ]
    .filter(Boolean)
    .join("、");
}
