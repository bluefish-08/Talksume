import {
  type ResumeContent,
  type ResumeItem,
  type ResumeSection,
  type ResumeTemplate,
  type ResumeTheme,
  skillLine,
} from "@talksume/core";
import { plainText } from "./text.ts";

export type Density = "roomy" | "loose" | "normal" | "compact" | "tight";

interface Geometry {
  fs: number;
  lh: number;
  /** 毫米 */
  margin: { y: number; x: number };
  secGap: number;
  itemGap: number;
  liGap: number;
  name: number;
  /** 抬头的内边距、色块、分隔线等额外高度。 */
  headPad: number;
  /** 分区标题除文字行外的线条与间距。 */
  titleExtra: number;
  /** 侧栏标题占掉的宽度，毫米。 */
  side: number;
  /** 余量拉伸的上限，0～1。 */
  maxStretch: number;
  /** 档位和拉伸对行距的影响系数，紧凑型模板行距基本不放大。 */
  lhScale: number;
  /** 最宽松只到这一档。 */
  loosest: Density;
}

export const GEOMETRY: Record<ResumeTemplate, Geometry> = {
  campus: {
    fs: 9.75,
    lh: 1.6,
    margin: { y: 13, x: 15 },
    secGap: 10,
    itemGap: 6,
    liGap: 1.5,
    name: 22,
    headPad: 4,
    titleExtra: 7,
    side: 0,
    maxStretch: 1,
    lhScale: 1,
    loosest: "roomy",
  },
  modern: {
    fs: 9.75,
    lh: 1.58,
    margin: { y: 11, x: 13 },
    secGap: 11,
    itemGap: 6.5,
    liGap: 1.5,
    name: 22,
    headPad: 26,
    titleExtra: 5,
    side: 0,
    maxStretch: 1,
    lhScale: 1,
    loosest: "roomy",
  },
  minimal: {
    fs: 9.75,
    lh: 1.62,
    margin: { y: 15, x: 18 },
    secGap: 13,
    itemGap: 7,
    liGap: 2,
    name: 24,
    headPad: 10,
    titleExtra: 6,
    side: 0,
    maxStretch: 1,
    lhScale: 1,
    loosest: "roomy",
  },
  tech: {
    fs: 9.25,
    lh: 1.48,
    margin: { y: 10, x: 12 },
    secGap: 8,
    itemGap: 4.5,
    liGap: 0.5,
    name: 20,
    headPad: 8,
    titleExtra: 0,
    side: 20,
    maxStretch: 0.6,
    lhScale: 0.35,
    loosest: "loose",
  },
};

export const TIERS: { density: Density; fs: number; lh: number; gap: number; margin: number }[] = [
  { density: "roomy", fs: 1, lh: 0.16, gap: 1.5, margin: 1.15 },
  { density: "loose", fs: 0.5, lh: 0.1, gap: 1.25, margin: 1.1 },
  { density: "normal", fs: 0, lh: 0, gap: 1, margin: 1 },
  { density: "compact", fs: -0.35, lh: -0.08, gap: 0.7, margin: 0.85 },
  { density: "tight", fs: -0.75, lh: -0.14, gap: 0.45, margin: 0.72 },
];

export interface Layout {
  density: Density;
  fs: number;
  lh: number;
  secGap: number;
  itemGap: number;
  liGap: number;
  margin: { y: number; x: number };
  name: number;
}

const PT_PER_MM = 72 / 25.4;
const PAGE = { w: 210, h: 297 };

/** 中文和全角字符占一个字宽，其余按半宽估。 */
function units(text: string): number {
  let n = 0;
  for (const ch of text) n += ch === " " ? 0.3 : (ch.codePointAt(0) ?? 0) <= 0x24f ? 0.55 : 1;
  return n;
}

function lines(text: string, perLine: number): number {
  return Math.max(1, Math.ceil(units(text) / perLine));
}

function round(n: number, step = 0.05): number {
  return Number((Math.round(n / step) * step).toFixed(2));
}

export function tierLayout(g: Geometry, tier: (typeof TIERS)[number]): Layout {
  return {
    density: tier.density,
    fs: round(g.fs + tier.fs),
    lh: round(g.lh + tier.lh * g.lhScale, 0.01),
    secGap: round(g.secGap * tier.gap, 0.5),
    itemGap: round(g.itemGap * tier.gap, 0.5),
    liGap: round(g.liGap * tier.gap, 0.25),
    margin: { y: round(g.margin.y * tier.margin, 0.5), x: round(g.margin.x * tier.margin, 0.5) },
    name: round(g.name + tier.fs * 2, 0.5),
  };
}

/** 粗估排版后的高度（pt），只用来挑密度档位，不追求精确。 */
export function estimateHeight(content: ResumeContent, g: Geometry, l: Layout, widthMm?: number): number {
  const width = (widthMm ?? PAGE.w - 2 * l.margin.x - g.side) * PT_PER_MM;
  const perLine = (indentEm: number) => width / l.fs - indentEm;
  const line = l.fs * l.lh;
  const { basics } = content;
  // 有侧栏的模板，分区标题在左栏、联系方式在姓名右侧，都不占额外高度
  const side = g.side > 0;
  let height = l.name * 1.3 + g.headPad;
  if (basics.headline) height += line;
  const contactText = [...basics.contacts, ...(basics.links ?? []).map((k) => k.url)].join(" | ");
  if (contactText && !side) height += lines(contactText, perLine(0) / 0.92) * line;
  if (basics.summary) height += lines(plainText(basics.summary), perLine(0)) * line + 4;

  const item = (it: ResumeItem, plain: boolean) => {
    let h = line;
    if (it.techStack?.length) h += line * 0.95;
    for (const b of it.bullets) {
      const text = plainText(`${b.lead ? `${b.lead}：` : ""}${b.text}`);
      h += lines(text, perLine(plain ? 0 : 1)) * line + l.liGap;
    }
    return h;
  };
  for (const section of content.sections) {
    if (section.items.length === 0) continue;
    height += l.secGap + (side ? 0 : l.fs * 1.15 * 1.4) + g.titleExtra;
    section.items.forEach((it, i) => {
      if (section.kind === "skills") {
        const { label, text } = skillLine(it);
        height += lines(`${label}：${text}`, perLine(0)) * line + l.liGap * 2;
        return;
      }
      height += (i > 0 ? l.itemGap : 0) + item(it, section.kind === "education");
    });
  }
  return height;
}

const available = (l: Layout) => (PAGE.h - 2 * l.margin.y) * PT_PER_MM;

/** 选定档位后还有余量时，把行距和段距放大一些去填，放大有上限，内容很少时仍会留白。 */
type Estimate = (l: Layout) => number;

function stretch(estimate: Estimate, g: Geometry, l: Layout): Layout {
  const target = available(l) * FILL;
  const at = (k: number): Layout => ({
    ...l,
    lh: round(l.lh + 0.08 * k * g.lhScale, 0.01),
    secGap: round(l.secGap * (1 + 0.6 * k), 0.5),
    itemGap: round(l.itemGap * (1 + 0.5 * k), 0.5),
    liGap: round(l.liGap * (1 + 0.5 * k), 0.25),
  });
  if (estimate(at(g.maxStretch)) <= target) return at(g.maxStretch);
  let [lo, hi] = [0, g.maxStretch];
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (estimate(at(mid)) <= target) lo = mid;
    else hi = mid;
  }
  return at(lo);
}

// 估算误差约 ±5%，留一点余量防止实际排版溢出到第二页
const FIT = 0.97;
const FILL = 0.96;

/** 从最宽松的档位开始试，第一档估得下一页的就用它并按余量拉伸；都放不下用最紧的一档，超出部分进第二页。 */
function pick(g: Geometry, estimate: Estimate, density?: Density): Layout {
  const layouts = TIERS.slice(TIERS.findIndex((t) => t.density === g.loosest)).map((tier) =>
    tierLayout(g, tier),
  );
  const forced = layouts.find((l) => l.density === density);
  if (forced) return forced;
  const fitting = layouts.find((l) => estimate(l) <= available(l) * FIT);
  return fitting ? stretch(estimate, g, fitting) : (layouts[layouts.length - 1] as Layout);
}

export function layoutFor(content: ResumeContent, template: ResumeTemplate, density?: Density): Layout {
  const g = GEOMETRY[template];
  return pick(g, (l) => estimateHeight(content, g, l), density);
}

export const SIDEBAR = { width: 52, gap: 6 } as const;
export const SIDEBAR_KINDS: readonly ResumeSection["kind"][] = ["education", "skills", "awards"];

export function themeGeometry(theme: ResumeTheme): Geometry {
  const base = GEOMETRY.campus;
  return {
    ...base,
    headPad: theme.header === "band" ? GEOMETRY.modern.headPad : theme.header === "rule" ? 10 : base.headPad,
    titleExtra: theme.headingStyle === "block" ? 6 : theme.headingStyle === "underline" ? 7 : 5,
  };
}

/** 两栏时抬头通栏，下面两栏取较高的一栏。 */
export function layoutForTheme(content: ResumeContent, theme: ResumeTheme, density?: Density): Layout {
  const g = themeGeometry(theme);
  const forced = density ?? (theme.density === "auto" ? undefined : theme.density);
  if (theme.layout === "single") return pick(g, (l) => estimateHeight(content, g, l), forced);
  const side = content.sections.filter((s) => SIDEBAR_KINDS.includes(s.kind));
  const main = content.sections.filter((s) => !SIDEBAR_KINDS.includes(s.kind));
  const empty: ResumeContent["basics"] = { name: "", contacts: [] };
  const body = (sections: ResumeSection[], l: Layout, w: number) =>
    estimateHeight({ basics: empty, sections }, g, l, w) - (l.name * 1.3 + g.headPad);
  const estimate = (l: Layout) => {
    const mainW = PAGE.w - 2 * l.margin.x - SIDEBAR.width - SIDEBAR.gap;
    return (
      estimateHeight({ ...content, sections: [] }, g, l) +
      Math.max(body(main, l, mainW), body(side, l, SIDEBAR.width))
    );
  };
  return pick(g, estimate, forced);
}
