// 页面骨架：内容仍全部来自用户数据，只换整页结构。每个分区/条目仍带 data-section/data-item，
// DOM 顺序保证抬头在前，ATS 抽出的文字是「姓名、联系方式 → 各分区」，不会左右交错。
import type { ResumeTheme } from "@talksume/core";

export type SkeletonName = NonNullable<ResumeTheme["skeleton"]>;

export interface SkeletonParts {
  head: string;
  /** 教育、技能、奖项这类放侧栏的分区。 */
  side: string;
  main: string;
  /** 不分栏时按原顺序拼好的全部分区。 */
  all: string;
}

export interface SkeletonSpec {
  /** 整页铺满纸面（页边距为 0，由骨架自己留内边距）。 */
  bleed: boolean;
  html: (p: SkeletonParts) => string;
  css: string;
}

const FULL = "296.5mm";

const SIDE_DARK = `
.resume { min-height: ${FULL}; isolation: isolate; }
.frame { display: grid; grid-template-columns: 68mm minmax(0, 1fr); min-height: ${FULL}; }
.side { background: var(--accent-deep); color: rgba(255,255,255,0.9); padding: 14mm 7mm 12mm 8mm; }
.side .head { padding: 0; background: none; border: 0; text-align: left; }
.side h1 { color: #fff; letter-spacing: 0.1em; line-height: 1.25; }
.side .headline { color: #fff; opacity: 0.92; font-weight: 500; }
.side .head::after { content: ""; display: block; width: 18pt; height: 2pt; margin-top: 8pt; background: rgba(255,255,255,0.7); }
.side .contacts { margin-top: 9pt; color: rgba(255,255,255,0.88); }
.side .contacts span { display: block; }
.side .summary { color: rgba(255,255,255,0.88); text-align: left; }
.side section { margin-top: var(--sec-gap); }
.side h2 { color: #fff; font-size: 1.02em; letter-spacing: 0.14em; padding-bottom: 2pt; margin-bottom: 4pt; border-bottom: 0.75pt solid rgba(255,255,255,0.38); }
.side .item-title, .side .lead, .side .num, .side .skill-line .item-title { color: #fff; }
.side .item-sub, .side .item-aside, .side .item-stack, .side .item-stack .label, .side .lvl { color: rgba(255,255,255,0.78); }
.side .item-sub::before, .side .item-meta::before { color: rgba(255,255,255,0.5); }
.side li { text-align: left; }
.side li::before { background: rgba(255,255,255,0.85); }
.side .item-head { flex-wrap: wrap; column-gap: 6pt; }
.side .item-title, .side .item-sub { display: block; }
.side .item-sub::before { display: none; }
.side .item-aside { white-space: normal; }
.side .skill-line { display: block; }
.side .skill-line .item-title { display: block; margin-bottom: 1.5pt; }
.side .tag { background: rgba(255,255,255,0.16); color: #fff; }
.main { padding: 14mm 12mm 12mm 10mm; min-width: 0; }
.main h2 { display: flex; align-items: center; gap: 6pt; color: var(--heading); letter-spacing: 0.08em; margin-bottom: 4pt; }
.main h2::before { content: ""; flex: none; width: 3.5pt; height: 1.05em; border-radius: 1.5pt; background: var(--accent); }
.main h2::after { content: ""; flex: 1; height: 0.75pt; background: var(--rule); }
.main section:first-child { margin-top: 0; }
`;

const SIDE_LIGHT = `
.resume { min-height: ${FULL}; isolation: isolate; }
.frame { display: grid; grid-template-columns: minmax(0, 1fr) 70mm; min-height: ${FULL}; }
.frame .side { grid-column: 2; grid-row: 1; background: color-mix(in srgb, var(--accent) 11%, #fff); border-left: 2.5pt solid var(--accent); padding: 14mm 8mm 12mm 7mm; }
.frame .main { grid-column: 1; grid-row: 1; padding: 14mm 9mm 12mm 12mm; min-width: 0; }
.side .head { padding: 0; background: none; border: 0; text-align: left; }
.side h1 { color: var(--heading); letter-spacing: 0.08em; line-height: 1.25; }
.side .headline { color: var(--accent-deep); font-weight: 600; }
.side .head::after { content: ""; display: block; width: 18pt; height: 2pt; margin-top: 8pt; background: var(--accent); }
.side .contacts { margin-top: 9pt; }
.side .contacts span { display: block; }
.side .summary { text-align: left; }
.side section { margin-top: var(--sec-gap); }
.side h2 { color: var(--heading); font-size: 1.02em; letter-spacing: 0.14em; padding-bottom: 2pt; margin-bottom: 4pt; border-bottom: 0.75pt solid var(--accent); }
.side .item-head { flex-wrap: wrap; column-gap: 6pt; }
.side .item-title, .side .item-sub { display: block; }
.side .item-sub::before { display: none; }
.side .item-aside { white-space: normal; }
.side .skill-line { display: block; }
.side .skill-line .item-title { display: block; color: var(--accent-deep); }
.side li { text-align: left; }
.main h2 { color: var(--heading); font-size: 1.12em; letter-spacing: 0.1em; padding-bottom: 1.5pt; border-bottom: 0.75pt solid var(--accent); margin-bottom: 4pt; }
.main section:first-child { margin-top: 0; }
`;

const BAND_COLS = `
.resume { min-height: ${FULL}; isolation: isolate; }
.head { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; column-gap: 14pt; background: var(--accent); padding: 13mm 12mm 7mm; }
.head h1 { color: #fff; letter-spacing: 0.08em; }
.head .headline { color: #fff; opacity: 0.95; }
.head .contacts { grid-column: 2; grid-row: 1; margin: 0; text-align: right; color: #fff; opacity: 0.92; }
.head .contacts span { display: block; }
.head .summary { grid-column: 1 / -1; margin-top: 7pt; color: #fff; opacity: 0.93; }
.frame { display: grid; grid-template-columns: minmax(0, 1fr) 62mm; column-gap: 8mm; padding: 7mm 12mm 12mm; }
.main { min-width: 0; }
.main section:first-child, .side section:first-child { margin-top: 0; }
.main h2 { display: flex; align-items: center; gap: 6pt; color: var(--heading); letter-spacing: 0.08em; margin-bottom: 4pt; }
.main h2::before { content: ""; flex: none; width: 3.5pt; height: 1.05em; border-radius: 1.5pt; background: var(--accent); }
.main h2::after { content: ""; flex: 1; height: 0.75pt; background: var(--rule); }
.side { background: var(--accent-soft); border-radius: 4pt; padding: 8pt 10pt 10pt; align-self: start; }
.side h2 { color: var(--heading); font-size: 1.02em; letter-spacing: 0.12em; padding-bottom: 2pt; margin-bottom: 4pt; border-bottom: 0.75pt solid var(--accent); }
.side .item-head { flex-wrap: wrap; column-gap: 6pt; }
.side .item-title, .side .item-sub { display: block; }
.side .item-sub::before { display: none; }
.side .item-aside { white-space: normal; }
.side .skill-line { display: block; }
.side .skill-line .item-title { display: block; color: var(--accent-deep); }
.side li { text-align: left; }
`;

const TIMELINE = `
.head { padding-bottom: 7pt; }
.head h1 { letter-spacing: 0.08em; }
.head .headline { color: var(--accent); font-weight: 600; }
.head .contacts span + span::before { content: "·"; margin: 0 0.6em; color: var(--faint); }
.frame { position: relative; margin-top: 4pt; padding-left: 17pt; }
.frame::before { content: ""; position: absolute; left: 4.5pt; top: 0.4em; bottom: 0; width: 1.25pt; background: color-mix(in srgb, var(--accent) 28%, #fff); }
section h2 { position: relative; color: var(--heading); font-size: 1.12em; letter-spacing: 0.1em; margin-bottom: 4pt; }
section h2::before { content: ""; position: absolute; left: -17pt; top: calc(50% - 5pt); width: 10pt; height: 10pt; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2.5pt #fff; }
.item, .skill-line { position: relative; }
.item::before { content: ""; position: absolute; left: -15pt; top: 0.55em; width: 5pt; height: 5pt; border-radius: 50%; background: #fff; border: 1.25pt solid var(--accent); }
.item-title { color: var(--ink); }
.item-sub { color: var(--accent); font-weight: 500; }
`;

const CARDS = `
.resume { box-sizing: border-box; background: #f1f3f7; padding: 9mm 10mm 9mm; min-height: ${FULL}; isolation: isolate; }
.head { background: #fff; border-radius: 5pt; padding: 11pt 14pt 10pt; border-top: 3.5pt solid var(--accent); }
.head h1 { letter-spacing: 0.08em; }
.head .headline { color: var(--accent); font-weight: 600; }
.head .contacts span + span::before { content: "·"; margin: 0 0.6em; color: var(--faint); }
.frame { margin-top: 0; }
section { background: #fff; border-radius: 5pt; padding: 7pt 12pt 8pt; margin-top: calc(var(--sec-gap) * 0.5); break-inside: avoid; }
section h2 { display: flex; align-items: center; gap: 6pt; color: var(--heading); font-size: 1.06em; letter-spacing: 0.1em; margin-bottom: 4.5pt; }
section h2::before { content: ""; flex: none; width: 6pt; height: 6pt; border-radius: 1.5pt; background: var(--accent); }
section h2::after { content: ""; flex: 1; height: 0.75pt; background: var(--rule); }
.item-sub { color: var(--accent); font-weight: 500; }
`;

const NUMBERED = `
.head { padding-bottom: 6pt; }
.head h1 { font-size: calc(var(--name) * 1.12); letter-spacing: 0.06em; }
.head h1::after { content: ""; display: block; width: 32pt; height: 3pt; margin-top: 6pt; background: var(--accent); }
.head .headline { margin-top: 6pt; color: var(--accent-deep); font-weight: 600; }
.head .contacts span + span::before { content: "/"; margin: 0 0.6em; color: var(--faint); }
.frame { counter-reset: sec; }
section { counter-increment: sec; position: relative; padding-left: 30pt; }
section h2 { color: var(--heading); font-size: 1.12em; letter-spacing: 0.1em; margin-bottom: 4pt; padding-bottom: 1.5pt; border-bottom: 0.75pt solid var(--rule); }
section h2::before { content: counter(sec, decimal-leading-zero); position: absolute; left: 0; top: -1pt; font-size: 1.55em; font-weight: 700; line-height: 1.1; color: var(--accent); font-variant-numeric: tabular-nums; }
`;

const frame = (inner: string) => `<div class="frame">${inner}</div>`;

export const SKELETONS: Record<Exclude<SkeletonName, "classic">, SkeletonSpec> = {
  "side-left": {
    bleed: true,
    css: SIDE_DARK,
    html: (p) => frame(`<aside class="side">${p.head}${p.side}</aside><div class="main">${p.main}</div>`),
  },
  "side-right": {
    bleed: true,
    css: SIDE_LIGHT,
    html: (p) => frame(`<aside class="side">${p.head}${p.side}</aside><div class="main">${p.main}</div>`),
  },
  "band-cols": {
    bleed: true,
    css: BAND_COLS,
    html: (p) =>
      `${p.head}${frame(`<div class="main">${p.main}</div><aside class="side">${p.side}</aside>`)}`,
  },
  timeline: { bleed: false, css: TIMELINE, html: (p) => `${p.head}${frame(p.all)}` },
  cards: { bleed: true, css: CARDS, html: (p) => `${p.head}${frame(p.all)}` },
  numbered: { bleed: false, css: NUMBERED, html: (p) => `${p.head}${frame(p.all)}` },
};

export function skeletonOf(theme: ResumeTheme): (SkeletonSpec & { name: SkeletonName }) | undefined {
  const name = theme.skeleton;
  if (!name || name === "classic") return undefined;
  return { name, ...SKELETONS[name] };
}
