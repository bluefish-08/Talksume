// 单栏 DOM、禁用连字、不用图片承载文字，保证 ATS 文本抽取顺序与视觉顺序一致
import {
  ACCENT_INFO,
  DEFAULT_RESUME_STYLE,
  fallbackPreset,
  RESUME_ACCENTS,
  RESUME_TEMPLATES,
  type ResumeBullet,
  type ResumeContent,
  type ResumeFontName,
  type ResumeItem,
  type ResumeLink,
  type ResumeSection,
  type ResumeStyle,
  type ResumeTemplate,
  type ResumeTheme,
  sanitizeTheme,
  templateUsesAccent,
} from "@talksume/core";
import { customCss } from "./custom-css.ts";
import { type Layout, layoutFor, layoutForTheme, SIDEBAR, SIDEBAR_KINDS } from "./layout.ts";
import { richSpans, typeset } from "./text.ts";
import { FONT_STACK_CSS, type RenderOptions, SERIF_STACK_CSS } from "./types.ts";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

export function resolveRenderStyle(options: RenderOptions = {}): ResumeStyle {
  const template = options.template ?? DEFAULT_RESUME_STYLE.template;
  const accent = options.accent ?? DEFAULT_RESUME_STYLE.accent;
  if (!RESUME_TEMPLATES.includes(template)) throw new Error(`未知简历模板: ${String(template)}`);
  if (!RESUME_ACCENTS.includes(accent)) throw new Error(`未知强调色: ${String(accent)}`);
  return { template, accent };
}

type SkillsMode = "line" | "tags";

interface TemplateSpec {
  skills: SkillsMode;
  css: string;
}

const MONO_STACK = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';

const BASE_CSS = `
.resume { position: relative; font-family: ${FONT_STACK_CSS}; font-size: var(--fs); line-height: var(--lh); background: #fff;
  font-variant-ligatures: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; text-rendering: optimizeLegibility;
  --ink: #111827; --body: #374151; --label: #4b5563; --muted: #6b7280; --faint: #9ca3af; --rule: #e5e7eb; color: var(--body);
  --accent-soft: color-mix(in srgb, var(--accent) 9%, #fff); --accent-deep: color-mix(in srgb, var(--accent) 78%, #000); }
.resume *, .resume *::before, .resume *::after { box-sizing: border-box; margin: 0; padding: 0; }
.resume h1, .resume h2 { font-size: inherit; font-weight: 700; }
.resume h1 { font-size: var(--name); line-height: 1.2; color: var(--ink); }
.resume .headline { margin-top: 2.5pt; font-size: 1.08em; font-weight: 500; color: var(--ink); }
.resume .contacts { margin-top: 2.5pt; font-size: 0.92em; color: var(--label); }
.resume .contacts span { display: inline-block; max-width: 100%; overflow-wrap: anywhere; }
.resume .summary, .resume li { text-align: justify; text-wrap: pretty; }
.resume .summary { margin-top: 4pt; }
.resume section { margin-top: var(--sec-gap); break-inside: auto; }
.resume h2 { break-after: avoid; }
.resume .item { break-inside: avoid; }
.resume .item + .item { margin-top: var(--item-gap); }
.resume .item-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12pt; }
.resume .item-main { min-width: 0; }
.resume .item-title { font-weight: 700; color: var(--ink); font-size: 1.04em; }
.resume .item-sub::before, .resume .item-meta::before { content: "·"; margin: 0 0.4em; color: var(--faint); }
.resume .item-aside { flex: none; white-space: nowrap; font-size: 0.92em; color: var(--muted); font-variant-numeric: tabular-nums; }
.resume .item-stack { margin-top: 0.5pt; font-size: 0.88em; color: var(--muted); }
.resume .item-stack .label { color: var(--label); }
.resume ul { list-style: none; margin-top: 1pt; }
.resume li { position: relative; padding-left: 1em; }
.resume li + li { margin-top: var(--li-gap); }
.resume ul.lines li { padding-left: 0; }
.resume ul.lines li::before { display: none; }
.resume .lead, .resume .num { font-weight: 700; color: var(--ink); }
.resume .num { white-space: nowrap; }
.resume .skill-line { break-inside: avoid; text-wrap: pretty; }
.resume .skill-line + .skill-line { margin-top: calc(var(--li-gap) + 1pt); }
.resume .skill-line .item-title { font-size: 1em; }
.resume .lvl { color: var(--muted); }
.resume .photo { display: none; }
`;

const TAGS_CSS = `
.skill-line { display: flex; align-items: baseline; gap: 6pt; }
.skill-line .item-title { flex: none; min-width: 4.2em; }
.tags { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2.5pt 3pt; }
.tag { padding: 0 4pt; border-radius: 2pt; background: var(--accent-soft); color: #1f2937; font-size: 0.92em; line-height: 1.5; }
.tags .lvl { font-size: 0.92em; }
.tags .lvl:not(:first-child) { margin-left: 4pt; }
`;

const dot = (size: string, color: string, radius = "50%") =>
  `li::before { content: ""; position: absolute; left: 0.28em; top: calc(var(--lh) * 0.5em - ${size} / 2); width: ${size}; height: ${size}; border-radius: ${radius}; background: ${color}; }`;

const TEMPLATES: Record<ResumeTemplate, TemplateSpec> = {
  campus: {
    skills: "line",
    css: `
.head { text-align: center; }
.head h1 { letter-spacing: 0.16em; }
.headline { color: var(--accent); }
.contacts span + span::before { content: ""; display: inline-block; width: 0.75pt; height: 0.8em; margin: 0 0.7em; background: #c7ccd4; vertical-align: -0.05em; }
.summary { text-align: center; text-wrap: balance; }
h2 { font-size: 1.12em; line-height: 1.4; color: var(--accent); letter-spacing: 0.1em; padding-bottom: 1.5pt; border-bottom: 0.75pt solid var(--accent); margin-bottom: 4pt; }
${dot("3pt", "#6b7280")}
`,
  },
  modern: {
    skills: "line",
    css: `
.head { background: var(--accent); border-radius: 3pt; padding: 12pt 15pt 11pt; }
.head h1 { color: #fff; letter-spacing: 0.08em; }
.headline { color: #fff; opacity: 0.95; }
.contacts { color: #fff; opacity: 0.88; }
.contacts span + span::before { content: "·"; margin: 0 0.6em; opacity: 0.7; }
.summary { color: #fff; opacity: 0.92; }
h2 { display: flex; align-items: center; gap: 6pt; font-size: 1.15em; line-height: 1.4; color: var(--ink); letter-spacing: 0.06em; margin-bottom: 3.5pt; }
h2::before { content: ""; flex: none; width: 3.5pt; height: 1.05em; border-radius: 1.5pt; background: var(--accent); }
h2::after { content: ""; flex: 1; height: 0.75pt; background: var(--rule); }
.item-sub { color: var(--accent); font-weight: 500; }
.lead { color: var(--accent-deep); }
.skill-line .item-title { color: var(--accent-deep); }
${dot("3.5pt", "var(--accent)", "1pt")}
`,
  },
  minimal: {
    skills: "line",
    css: `
.resume { --ink: #111111; --body: #333333; --label: #444444; --muted: #666666; --faint: #999999; --rule: #bbbbbb; }
.head { padding-bottom: 7pt; border-bottom: 0.75pt solid #111111; }
.head h1 { font-family: ${SERIF_STACK_CSS}; letter-spacing: 0.18em; }
.headline { font-weight: 400; color: #333333; letter-spacing: 0.04em; }
.contacts span + span::before { content: "/"; margin: 0 0.7em; color: #aaaaaa; }
h2 { display: flex; align-items: center; gap: 8pt; font-size: 1em; line-height: 1.4; letter-spacing: 0.3em; color: #111111; margin-bottom: 3.5pt; }
h2::after { content: ""; flex: 1; height: 0.5pt; background: var(--rule); }
li::before { content: ""; position: absolute; left: 0.1em; top: calc(var(--lh) * 0.5em); width: 0.45em; height: 0.75pt; background: #777777; }
`,
  },
  tech: {
    skills: "tags",
    css: `
.head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; column-gap: 14pt; padding-bottom: 5pt; border-bottom: 1.5pt solid var(--accent); }
.head h1 { letter-spacing: 0.04em; }
.headline { font-size: 1em; font-weight: 600; color: var(--accent); }
.contacts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0 9pt; max-width: 60%; margin: 0 0 0 auto; font-size: 0.9em; }
.summary { flex-basis: 100%; }
section { display: grid; grid-template-columns: 16mm minmax(0, 1fr); column-gap: 4mm; }
h2 { font-size: 1.02em; line-height: var(--lh); color: var(--accent); letter-spacing: 0.04em; text-align: right; }
.sec-body { padding-left: 4mm; border-left: 0.75pt solid var(--rule); }
.item-stack .stack { font-family: ${MONO_STACK}; font-size: 0.95em; }
${dot("2.5pt", "var(--accent)")}
${TAGS_CSS}`,
  },
};

/** 每条规则都限定在 .resume 下，网页预览把片段放进 shadow DOM 时不受宿主样式影响。 */
function scopeCss(css: string): string {
  return css.replace(/(^|})\s*([^{}@]+)\{/g, (_m, close: string, selectors: string) => {
    const scoped = selectors
      .split(",")
      .map((s) => s.trim())
      .map((s) => (s.startsWith(".resume") ? s : `.resume ${s}`))
      .join(", ");
    return `${close}\n${scoped} {`;
  });
}

const text = (raw: string) => escapeHtml(typeset(raw));

function rich(raw: string): string {
  return richSpans(raw)
    .map((s) => (s.strong ? `<b class="num">${escapeHtml(s.text)}</b>` : escapeHtml(s.text)))
    .join("");
}

function bulletHtml(b: ResumeBullet): string {
  const lead = b.lead?.trim() ? `<b class="lead">${text(b.lead)}</b>：` : "";
  return `${lead}${rich(b.text)}`;
}

function bulletList(item: ResumeItem, at: string, plain: boolean): string {
  if (item.bullets.length === 0) return "";
  const lis = item.bullets.map((b, i) => `<li data-bullet="${at}-${i}">${bulletHtml(b)}</li>`).join("");
  return `<ul${plain ? ' class="lines"' : ""}>${lis}</ul>`;
}

function renderItem(item: ResumeItem, at: string, plain: boolean): string {
  const sub = item.subheading ? `<span class="item-sub">${text(item.subheading)}</span>` : "";
  const aside = [
    item.period ? `<span class="item-period">${escapeHtml(item.period)}</span>` : "",
    item.meta ? `<span class="item-meta">${text(item.meta)}</span>` : "",
  ].join("");
  const head = `<div class="item-head"><div class="item-main"><span class="item-title">${text(item.heading)}</span>${sub}</div>${aside ? `<div class="item-aside">${aside}</div>` : ""}</div>`;
  const stack = item.techStack?.length
    ? `<p class="item-stack"><span class="label">技术栈：</span><span class="stack">${item.techStack.map(text).join(" / ")}</span></p>`
    : "";
  return `<div class="item" data-item="${at}">${head}${stack}${bulletList(item, at, plain)}</div>`;
}

function renderSkillLine(item: ResumeItem, at: string): string {
  const label = item.heading.trim();
  const head = label ? `<span class="item-title">${text(label)}：</span>` : "";
  const body = item.bullets
    .map((b) => `${b.lead ? `<span class="lvl">${text(b.lead)}</span> ` : ""}${text(b.text)}`)
    .join("；");
  return `<p class="skill-line" data-item="${at}">${head}${body}</p>`;
}

/** 按顿号、分号切词，括号里的顿号不切。 */
export function skillTokens(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if ("（(".includes(ch)) depth++;
    if ("）)".includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && "、；;".includes(ch)) {
      tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  tokens.push(current);
  return tokens.map((t) => t.trim()).filter(Boolean);
}

const TAG_MAX_LENGTH = 16;

/** 标签之间保留空格，抽取出的纯文本仍是分隔开的词；整句式的技能描述退回成一行文字。 */
function renderSkillTags(item: ResumeItem, at: string): string {
  const groups = item.bullets.map((b) => ({ lead: b.lead, tokens: skillTokens(b.text) }));
  const tokens = groups.flatMap((g) => g.tokens);
  if (tokens.some((t) => t.length > TAG_MAX_LENGTH || /[，。,]/.test(t))) return renderSkillLine(item, at);
  const tags = groups
    .map(
      (g) =>
        `${g.lead ? `<span class="lvl">${text(g.lead)}</span> ` : ""}${g.tokens.map((t) => `<span class="tag">${text(t)}</span>`).join(" ")}`,
    )
    .join(" ");
  const label = item.heading.trim();
  const head = label ? `<span class="item-title">${text(label)}</span>` : "";
  return `<p class="skill-line" data-item="${at}">${head}<span class="tags">${tags}</span></p>`;
}

function renderSection(section: ResumeSection, index: number, mode: SkillsMode): string {
  if (section.items.length === 0) return "";
  const skills = mode === "tags" ? renderSkillTags : renderSkillLine;
  const plain = section.kind === "education";
  const items = section.items
    .map((item, i) =>
      section.kind === "skills" ? skills(item, `${index}-${i}`) : renderItem(item, `${index}-${i}`, plain),
    )
    .join("");
  return `<section data-kind="${section.kind}" data-section="${index}"><h2>${escapeHtml(section.title)}</h2><div class="sec-body">${items}</div></section>`;
}

export function linkText({ label, url }: ResumeLink): string {
  const shown = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return label && !shown.toLowerCase().includes(label.toLowerCase()) ? `${label}：${shown}` : shown;
}

export interface ResumeFragment {
  css: string;
  html: string;
  margin: string;
  style: ResumeStyle;
  layout: Layout;
  /** 定制 CSS 用到的内置字体名；预览据此向服务端取 @font-face。 */
  fonts: ResumeFontName[];
}

function contactKind(raw: string): "phone" | "email" | "text" {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())) return "email";
  if (/^\+?[\d\s-]{7,}$/.test(raw.trim())) return "phone";
  return "text";
}

/** custom 为真时多带两个只给定制 CSS 用的钩子：联系方式类型、照片占位（默认不显示）。 */
function headHtml(content: ResumeContent, custom = false): string {
  const { name, headline, contacts, links = [], summary } = content.basics;
  const contactItems = [
    ...contacts.map((c) => ({ html: text(c), kind: contactKind(c) })),
    ...links.map((l) => ({ html: escapeHtml(linkText(l)), kind: "link" as const })),
  ];
  const attr = (kind: string) => (custom ? ` data-k="${kind}"` : "");
  const contactHtml = contactItems.length
    ? `<div class="contacts">${contactItems.map((c) => `<span${attr(c.kind)}>${c.html}</span>`).join("")}</div>`
    : "";
  const photo = custom ? '<div class="photo" aria-hidden="true"></div>' : "";
  const headlineHtml = headline ? `<p class="headline">${text(headline)}</p>` : "";
  const summaryHtml = summary ? `<p class="summary">${text(summary)}</p>` : "";
  return `<header class="head">${photo}<div class="head-main"><h1>${escapeHtml(name)}</h1>${headlineHtml}</div>${contactHtml}${summaryHtml}</header>`;
}

function layoutVars(layout: Layout): string[] {
  return [
    `--fs: ${layout.fs}pt`,
    `--lh: ${layout.lh}`,
    `--name: ${layout.name}pt`,
    `--sec-gap: ${layout.secGap}pt`,
    `--item-gap: ${layout.itemGap}pt`,
    `--li-gap: ${layout.liGap}pt`,
  ];
}

const FONT = { sans: FONT_STACK_CSS, serif: SERIF_STACK_CSS } as const;

const THEME_HEADER: Record<ResumeTheme["header"], string> = {
  plain: `
.headline { color: var(--accent); }
.contacts span + span::before { content: "·"; margin: 0 0.6em; color: var(--faint); }`,
  rule: `
.head { padding-bottom: 6pt; border-bottom: 1.25pt solid var(--accent); }
.headline { color: var(--accent); }
.contacts span + span::before { content: "/"; margin: 0 0.6em; color: var(--faint); }`,
  band: `
.head { background: var(--accent); border-radius: 3pt; padding: 12pt 15pt 11pt; }
.head h1, .headline, .contacts, .summary { color: #fff; }
.contacts { opacity: 0.9; }
.contacts span + span::before { content: "·"; margin: 0 0.6em; opacity: 0.7; }`,
};

const THEME_HEADING: Record<ResumeTheme["headingStyle"], string> = {
  underline: `
h2 { font-size: 1.12em; line-height: 1.4; color: var(--heading); letter-spacing: 0.08em; padding-bottom: 1.5pt; border-bottom: 0.75pt solid var(--accent); margin-bottom: 4pt; }`,
  bar: `
h2 { display: flex; align-items: center; gap: 6pt; font-size: 1.12em; line-height: 1.4; color: var(--heading); letter-spacing: 0.06em; margin-bottom: 3.5pt; }
h2::before { content: ""; flex: none; width: 3.5pt; height: 1.05em; border-radius: 1.5pt; background: var(--accent); }
h2::after { content: ""; flex: 1; height: 0.75pt; background: var(--rule); }`,
  block: `
h2 { font-size: 1.04em; line-height: 1.6; color: #fff; background: var(--heading); padding: 0 6pt; border-radius: 2pt; letter-spacing: 0.12em; margin-bottom: 4pt; }`,
  plain: `
h2 { font-size: 1.12em; line-height: 1.4; color: var(--heading); letter-spacing: 0.14em; margin-bottom: 3pt; }`,
};

const THEME_BULLET: Record<ResumeTheme["bullet"], string> = {
  dot: dot("3pt", "var(--accent)"),
  square: dot("3.5pt", "var(--accent)", "0.5pt"),
  dash: `li::before { content: ""; position: absolute; left: 0.1em; top: calc(var(--lh) * 0.5em); width: 0.5em; height: 0.75pt; background: var(--accent); }`,
};

const SIDEBAR_CSS = `
.cols { display: grid; grid-template-columns: ${SIDEBAR.width}mm minmax(0, 1fr); column-gap: ${SIDEBAR.gap}mm; margin-top: var(--sec-gap); }
.cols section:first-child { margin-top: 0; }
.side { padding-right: ${SIDEBAR.gap / 2}mm; border-right: 0.75pt solid var(--rule); }
.side .item-head { flex-wrap: wrap; column-gap: 6pt; }
.side .item-aside { white-space: normal; }
.side .skill-line { display: block; }
.side .skill-line .item-title { display: block; }`;

/** 主题 CSS 只由上面的常量片段拼成；唯一的变量是已校验的 hex 颜色，放在内联 CSS 变量里。 */
function themeCss(theme: ResumeTheme): string {
  return [
    `.resume { font-family: ${FONT[theme.bodyFont]}; }`,
    `h1, h2 { font-family: ${FONT[theme.headingFont]}; }`,
    theme.headingFont === "serif" ? "h1 { letter-spacing: 0.14em; }" : "h1 { letter-spacing: 0.06em; }",
    theme.headerAlign === "center"
      ? ".head { text-align: center; } .summary { text-align: center; text-wrap: balance; }"
      : "",
    THEME_HEADER[theme.header],
    THEME_HEADING[theme.headingStyle],
    THEME_BULLET[theme.bullet],
    ".lead { color: var(--accent-deep); }",
    theme.skills === "tags" ? TAGS_CSS : "",
    theme.layout === "sidebar" ? SIDEBAR_CSS : "",
  ].join("\n");
}

function renderThemed(content: ResumeContent, theme: ResumeTheme, options: RenderOptions): ResumeFragment {
  const layout = layoutForTheme(content, theme, options.density);
  const extra = customCss(options);
  const sections = content.sections.map((s, i) => ({ s, html: renderSection(s, i, theme.skills) }));
  const side = sections.filter((x) => SIDEBAR_KINDS.includes(x.s.kind) && x.html);
  const main = sections.filter((x) => !SIDEBAR_KINDS.includes(x.s.kind) && x.html);
  const join = (xs: typeof sections) => xs.map((x) => x.html).join("\n");
  // DOM 先侧栏后正文，文本抽取是「教育、技能 → 经历」整块读出，不会左右交错
  const body =
    theme.layout === "sidebar" && side.length > 0 && main.length > 0
      ? `<div class="cols"><aside class="side">${join(side)}</aside><div class="main">${join(main)}</div></div>`
      : join(sections);
  const vars = [
    `--accent: ${theme.accent}`,
    `--heading: ${theme.headingColor ?? theme.accent}`,
    ...layoutVars(layout),
  ].join("; ");
  const html = `<div class="resume th l-${theme.layout} d-${layout.density}${extra ? " custom" : ""}" style="${vars}">
${headHtml(content, Boolean(extra))}
${body}
</div>`;
  const preset = options.template && options.accent ? resolveRenderStyle(options) : fallbackPreset(theme);
  return {
    css: BASE_CSS + scopeCss(themeCss(theme)) + (extra ? `\n${extra.css}` : ""),
    html,
    margin: `${layout.margin.y}mm ${layout.margin.x}mm`,
    style: { ...preset, theme },
    layout,
    fonts: extra?.fonts ?? [],
  };
}

/** 不含 html/body 的简历片段：PDF 包成整页文档，网页预览直接挂进 shadow DOM，两边同源。 */
export function renderFragment(content: ResumeContent, options: RenderOptions = {}): ResumeFragment {
  const theme = options.theme ? sanitizeTheme(options.theme)?.theme : undefined;
  if (theme) return renderThemed(content, theme, options);
  const style = resolveRenderStyle(options);
  const spec = TEMPLATES[style.template];
  const layout = layoutFor(content, style.template, options.density);
  const extra = customCss(options);
  const sections = content.sections.map((s, i) => renderSection(s, i, spec.skills)).join("\n");
  const accent = templateUsesAccent(style.template) ? ACCENT_INFO[style.accent].hex : "#111111";
  const vars = [`--accent: ${accent}`, ...layoutVars(layout)].join("; ");
  const html = `<div class="resume t-${style.template} d-${layout.density}${extra ? " custom" : ""}" style="${vars}">
${headHtml(content, Boolean(extra))}
${sections}
</div>`;
  const margin = `${layout.margin.y}mm ${layout.margin.x}mm`;
  return {
    css: BASE_CSS + scopeCss(spec.css) + (extra ? `\n${extra.css}` : ""),
    html,
    margin,
    style,
    layout,
    fonts: extra?.fonts ?? [],
  };
}

export function renderHtml(content: ResumeContent, options: RenderOptions = {}): string {
  const { css, html, margin } = renderFragment(content, options);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data: https://fonts.talksume.invalid">
<title>${escapeHtml(content.basics.name)} - 简历</title>
<style>@page { size: A4; margin: ${margin}; }
html, body { margin: 0; padding: 0; background: #fff; }${options.fontFaces ? `\n${options.fontFaces}` : ""}${css}</style>
</head>
<body>
${html}
</body>
</html>
`;
}

/** 屏幕预览用的整页文档：和 PDF 同一份片段，边距换成纸面内边距，用来截图。 */
export function renderScreenHtml(content: ResumeContent, options: RenderOptions = {}): string {
  const { css, html, margin } = renderFragment(content, options);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data: https://fonts.talksume.invalid">
<style>html, body { margin: 0; padding: 0; background: #fff; }
.page { box-sizing: border-box; width: 210mm; min-height: 297mm; padding: ${margin}; background: #fff; }${options.fontFaces ? `\n${options.fontFaces}` : ""}${css}</style>
</head>
<body>
<div class="page">${html}</div>
</body>
</html>
`;
}
