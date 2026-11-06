// 内置素材：模型只能按名字引用，SVG 和字体栈都是这里的常量

const LINE = `fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
const icon = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${LINE}>${body}</svg>`;
const tile = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export interface ResumeAsset {
  /** 给模型看的一句话。 */
  label: string;
  svg: string;
  /** icon 可用 mask 着色；tile 横向平铺；ornament 单个装饰；photo 是彩色占位图。 */
  kind: "icon" | "tile" | "ornament" | "photo";
}

export const RESUME_ASSETS = {
  "icon-phone": {
    label: "电话",
    kind: "icon",
    svg: icon(
      `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>`,
    ),
  },
  "icon-mail": {
    label: "邮箱",
    kind: "icon",
    svg: icon(
      `<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>`,
    ),
  },
  "icon-location": {
    label: "地点",
    kind: "icon",
    svg: icon(`<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>`),
  },
  "icon-github": {
    label: "GitHub",
    kind: "icon",
    svg: icon(
      `<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>`,
    ),
  },
  "icon-link": {
    label: "链接",
    kind: "icon",
    svg: icon(
      `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
    ),
  },
  "icon-globe": {
    label: "网站",
    kind: "icon",
    svg: icon(
      `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`,
    ),
  },
  "icon-user": {
    label: "人物",
    kind: "icon",
    svg: icon(`<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`),
  },
  "icon-school": {
    label: "学位帽（教育）",
    kind: "icon",
    svg: icon(`<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>`),
  },
  "icon-briefcase": {
    label: "公文包（经历）",
    kind: "icon",
    svg: icon(
      `<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>`,
    ),
  },
  "icon-code": {
    label: "代码（项目、技能）",
    kind: "icon",
    svg: icon(`<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>`),
  },
  "icon-award": {
    label: "奖牌（奖项）",
    kind: "icon",
    svg: icon(`<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>`),
  },
  "icon-book": {
    label: "书本",
    kind: "icon",
    svg: icon(
      `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`,
    ),
  },
  "icon-calendar": {
    label: "日历",
    kind: "icon",
    svg: icon(
      `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
    ),
  },
  "icon-star": {
    label: "星星",
    kind: "icon",
    svg: icon(
      `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
    ),
  },
  "icon-flag": {
    label: "旗帜（校园）",
    kind: "icon",
    svg: icon(
      `<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>`,
    ),
  },
  "icon-bolt": {
    label: "闪电",
    kind: "icon",
    svg: icon(`<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`),
  },
  "icon-check": {
    label: "对勾",
    kind: "icon",
    svg: icon(`<polyline points="20 6 9 17 4 12"/>`),
  },
  "icon-dot": {
    label: "实心圆点",
    kind: "icon",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>`,
  },
  "icon-diamond": {
    label: "实心菱形",
    kind: "icon",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 3l9 9-9 9-9-9z"/></svg>`,
  },
  "icon-arrow": {
    label: "右箭头",
    kind: "icon",
    svg: icon(`<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>`),
  },
  "divider-dots": {
    label: "点线（横向平铺）",
    kind: "tile",
    svg: tile(10, 4, `<circle cx="5" cy="2" r="1" fill="#000" stroke="none"/>`),
  },
  "divider-dashes": {
    label: "虚线（横向平铺）",
    kind: "tile",
    svg: tile(12, 4, `<line x1="1" y1="2" x2="8" y2="2"/>`),
  },
  "divider-wave": {
    label: "波浪线（横向平铺）",
    kind: "tile",
    svg: tile(16, 6, `<path d="M0 3Q4 -1 8 3T16 3"/>`),
  },
  "divider-zigzag": {
    label: "锯齿线（横向平铺）",
    kind: "tile",
    svg: tile(10, 6, `<polyline points="0,5 5,1 10,5"/>`),
  },
  "divider-double": {
    label: "双线（横向平铺）",
    kind: "tile",
    svg: tile(8, 6, `<line x1="0" y1="1.5" x2="8" y2="1.5"/><line x1="0" y1="4.5" x2="8" y2="4.5"/>`),
  },
  "ornament-diamond": {
    label: "菱形装饰（单个，宽 48 高 12）",
    kind: "ornament",
    svg: tile(
      48,
      12,
      `<line x1="0" y1="6" x2="18" y2="6"/><path d="M24 1l5 5-5 5-5-5z"/><line x1="30" y1="6" x2="48" y2="6"/>`,
    ),
  },
  "ornament-corner": {
    label: "直角折角装饰（单个，24×24）",
    kind: "ornament",
    svg: tile(24, 24, `<path d="M2 22V2h20"/>`),
  },
  "photo-placeholder": {
    label: "证件照占位（灰色人像，彩色图，不要用 mask）",
    kind: "photo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 130"><rect width="100" height="130" fill="#e5e7eb"/><circle cx="50" cy="48" r="20" fill="#9ca3af"/><path d="M12 130c0-28 17-42 38-42s38 14 38 42z" fill="#9ca3af"/></svg>`,
  },
} as const satisfies Record<string, ResumeAsset>;

export type ResumeAssetName = keyof typeof RESUME_ASSETS;
export const RESUME_ASSET_NAMES = Object.keys(RESUME_ASSETS) as ResumeAssetName[];

export function isAssetName(name: string): name is ResumeAssetName {
  return Object.hasOwn(RESUME_ASSETS, name);
}

export function assetDataUri(name: ResumeAssetName): string {
  return `data:image/svg+xml,${encodeURIComponent(RESUME_ASSETS[name].svg)}`;
}

export interface ResumeFont {
  label: string;
  /** 本机没有打包字体时的回落栈，名字也是 @font-face 的 family。 */
  stack: string;
  weights: readonly number[];
}

/** 字体文件随渲染包打包（@fontsource），模型只能写这几个名字。 */
export const RESUME_FONTS = {
  song: {
    label: "思源宋体（衬线，正式、文艺）",
    stack: `"Talksume Song", "Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif`,
    weights: [400, 700],
  },
  hei: {
    label: "思源黑体（无衬线，现代、清爽）",
    stack: `"Talksume Hei", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`,
    weights: [400, 700],
  },
  brush: {
    label: "马善政楷书（毛笔楷体，只适合姓名或分区标题，正文不要用）",
    stack: `"Talksume Brush", "Ma Shan Zheng", "Kaiti SC", "STKaiti", "KaiTi", serif`,
    weights: [400],
  },
} as const satisfies Record<string, ResumeFont>;

export type ResumeFontName = keyof typeof RESUME_FONTS;
export const RESUME_FONT_NAMES = Object.keys(RESUME_FONTS) as ResumeFontName[];

export function isFontName(name: string): name is ResumeFontName {
  return Object.hasOwn(RESUME_FONTS, name);
}
