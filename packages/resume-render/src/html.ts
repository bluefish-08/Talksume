// 单栏 DOM、禁用连字、不用图片承载文字，保证 ATS 文本抽取顺序与视觉顺序一致
import {
  ACCENT_INFO,
  DEFAULT_RESUME_STYLE,
  RESUME_ACCENTS,
  RESUME_TEMPLATES,
  type ResumeContent,
  type ResumeItem,
  type ResumeSection,
  type ResumeStyle,
  type ResumeTemplate,
  skillLine,
} from "@talksume/core";
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

interface TemplateSpec {
  /** 同时用于 PDF 的 @page 页边距和网页预览的纸张内边距。 */
  margin: string;
  skills: "line" | "tags";
  css: string;
}

const BASE_CSS = `
.resume { font-family: ${FONT_STACK_CSS}; color: #1f2937; background: #fff; font-variant-ligatures: none;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; text-rendering: optimizeLegibility;
  --accent-soft: color-mix(in srgb, var(--accent) 9%, #fff); --accent-line: color-mix(in srgb, var(--accent) 35%, #fff); }
.resume *, .resume *::before, .resume *::after { box-sizing: border-box; margin: 0; padding: 0; }
.resume h1, .resume h2 { font-size: inherit; font-weight: 700; }
.resume .contacts { overflow-wrap: anywhere; }
.resume .summary, .resume li { text-align: justify; }
.resume section { break-inside: auto; }
.resume h2 { break-after: avoid; }
.resume .item { break-inside: avoid; }
.resume .item-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12pt; }
.resume .item-main { min-width: 0; }
.resume .item-title { font-weight: 700; color: #111827; }
.resume .item-period { flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
.resume ul { list-style: none; }
.resume li { position: relative; }
.resume .skill-line { break-inside: avoid; }
`;

const TEMPLATES: Record<ResumeTemplate, TemplateSpec> = {
  campus: {
    margin: "14mm 16mm",
    skills: "line",
    css: `
.resume { font-size: 9.75pt; line-height: 1.62; }
.head { text-align: center; padding-bottom: 4pt; }
.head h1 { font-size: 21pt; line-height: 1.25; letter-spacing: 0.14em; color: #111827; }
.contacts { margin-top: 4pt; font-size: 9pt; color: #4b5563; }
.contacts span + span::before { content: ""; display: inline-block; width: 1px; height: 0.8em; margin: 0 0.75em; background: #c7ccd4; vertical-align: -0.05em; }
.summary { margin-top: 6pt; color: #374151; text-align: center; text-wrap: balance; }
section { margin-top: 11pt; }
h2 { font-size: 11pt; line-height: 1.4; color: var(--accent); letter-spacing: 0.08em; padding-bottom: 2pt; border-bottom: 1pt solid var(--accent); margin-bottom: 5pt; }
.item + .item { margin-top: 6pt; }
.item-title { font-size: 10pt; }
.item-sub { margin-left: 1.1em; color: #374151; font-weight: 500; }
.item-period { font-size: 9pt; color: #4b5563; }
ul { margin-top: 2pt; }
li { padding-left: 1em; color: #374151; }
li + li { margin-top: 1.5pt; }
li::before { content: ""; position: absolute; left: 0.25em; top: calc(0.81em - 1.5pt); width: 3pt; height: 3pt; border-radius: 50%; background: #6b7280; }
.skill-line + .skill-line { margin-top: 2pt; }
.skill-line .item-title { color: #111827; }
`,
  },
  modern: {
    margin: "12mm 14mm",
    skills: "line",
    css: `
.resume { font-size: 9.75pt; line-height: 1.6; }
.head { background: var(--accent); color: #fff; border-radius: 4pt; padding: 13pt 16pt 12pt; }
.head h1 { font-size: 22pt; line-height: 1.2; letter-spacing: 0.08em; }
.contacts { margin-top: 5pt; font-size: 9pt; color: rgba(255, 255, 255, 0.9); }
.contacts span + span::before { content: "·"; margin: 0 0.6em; opacity: 0.7; }
.summary { margin-top: 7pt; font-size: 9.25pt; color: rgba(255, 255, 255, 0.92); }
section { margin-top: 12pt; }
h2 { display: flex; align-items: center; gap: 6pt; font-size: 11.5pt; line-height: 1.4; color: #111827; letter-spacing: 0.06em; margin-bottom: 5pt; }
h2::before { content: ""; flex: none; width: 3.5pt; height: 12pt; border-radius: 1.5pt; background: var(--accent); }
h2::after { content: ""; flex: 1; height: 0.75pt; background: #e5e7eb; }
.item + .item { margin-top: 7pt; }
.item-title { font-size: 10pt; }
.item-sub { margin-left: 0.9em; color: var(--accent); font-weight: 500; }
.item-period { font-size: 9pt; color: #6b7280; }
ul { margin-top: 2.5pt; }
li { padding-left: 1em; color: #374151; }
li + li { margin-top: 1.5pt; }
li::before { content: ""; position: absolute; left: 0.2em; top: calc(0.8em - 2pt); width: 4pt; height: 4pt; border-radius: 1pt; background: var(--accent); }
.skill-line { padding-left: 2pt; }
.skill-line + .skill-line { margin-top: 2.5pt; }
.skill-line .item-title { color: var(--accent); }
`,
  },
  minimal: {
    margin: "18mm 20mm",
    skills: "line",
    css: `
.resume { font-size: 9.75pt; line-height: 1.66; color: #222; }
.head { padding-bottom: 9pt; border-bottom: 0.75pt solid #111; }
.head h1 { font-family: ${SERIF_STACK_CSS}; font-size: 24pt; line-height: 1.2; letter-spacing: 0.2em; color: #111; font-weight: 700; }
.contacts { margin-top: 6pt; font-size: 9pt; color: #444; letter-spacing: 0.02em; }
.contacts span + span::before { content: "/"; margin: 0 0.8em; color: #aaa; }
.summary { margin-top: 6pt; color: #333; }
section { margin-top: 15pt; }
h2 { font-size: 9.5pt; line-height: 1.4; letter-spacing: 0.32em; color: var(--accent); margin-bottom: 6pt; }
.item + .item { margin-top: 8pt; }
.item-title { font-size: 10pt; color: #111; font-weight: 600; }
.item-sub { color: #444; }
.item-sub::before { content: "·"; margin: 0 0.5em; color: #999; }
.item-period { font-size: 9pt; color: #555; }
ul { margin-top: 2.5pt; }
li { padding-left: 1.05em; color: #333; }
li + li { margin-top: 2pt; }
li::before { content: "–"; position: absolute; left: 0; color: #777; }
.skill-line + .skill-line { margin-top: 2.5pt; }
.skill-line .item-title { font-weight: 600; }
`,
  },
  tech: {
    margin: "11mm 13mm",
    skills: "tags",
    css: `
.resume { font-size: 9pt; line-height: 1.48; }
.head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; column-gap: 16pt; padding-bottom: 6pt; border-bottom: 1.5pt solid var(--accent); }
.head h1 { font-size: 19pt; line-height: 1.2; letter-spacing: 0.06em; color: #111827; }
.contacts { font-size: 8.75pt; color: #4b5563; text-align: right; }
.contacts span + span::before { content: "|"; margin: 0 0.55em; color: #c7ccd4; }
.summary { flex-basis: 100%; margin-top: 4pt; color: #374151; }
section { display: grid; grid-template-columns: 17mm minmax(0, 1fr); column-gap: 4mm; margin-top: 8pt; }
h2 { font-size: 9.75pt; line-height: 1.48; color: var(--accent); letter-spacing: 0.04em; text-align: right; }
.sec-body { padding-left: 4mm; border-left: 0.75pt solid #e5e7eb; }
.item + .item { margin-top: 4.5pt; }
.item-title { font-size: 9.5pt; }
.item-sub { margin-left: 0.8em; color: #4b5563; }
.item-period { font-size: 8.5pt; color: #6b7280; }
ul { margin-top: 1pt; }
li { padding-left: 0.95em; color: #374151; }
li + li { margin-top: 0.5pt; }
li::before { content: ""; position: absolute; left: 0.15em; top: calc(0.74em - 1.25pt); width: 2.5pt; height: 2.5pt; border-radius: 50%; background: var(--accent); }
.skill-line { display: flex; align-items: baseline; gap: 6pt; }
.skill-line + .skill-line { margin-top: 3pt; }
.skill-line .item-title { flex: none; min-width: 2.6em; font-size: 9pt; }
.tags { display: flex; flex-wrap: wrap; gap: 2.5pt 3pt; }
.tag { padding: 0 4.5pt; border-radius: 2pt; background: var(--accent-soft); color: #1f2937; font-size: 8.5pt; line-height: 1.55; }
`,
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

function bulletList(item: ResumeItem, at: string): string {
  if (item.bullets.length === 0) return "";
  const lis = item.bullets.map((b, i) => `<li data-bullet="${at}-${i}">${escapeHtml(b.text)}</li>`).join("");
  return `<ul>${lis}</ul>`;
}

function renderItem(item: ResumeItem, at: string): string {
  const sub = item.subheading ? `<span class="item-sub">${escapeHtml(item.subheading)}</span>` : "";
  const period = item.period ? `<span class="item-period">${escapeHtml(item.period)}</span>` : "";
  const head = `<div class="item-head"><div class="item-main"><span class="item-title">${escapeHtml(item.heading)}</span>${sub}</div>${period}</div>`;
  return `<div class="item" data-item="${at}">${head}${bulletList(item, at)}</div>`;
}

function renderSkillLine(item: ResumeItem, at: string): string {
  const { label, text } = skillLine(item);
  const head = label ? `<span class="item-title">${escapeHtml(label)}：</span>` : "";
  return `<p class="skill-line" data-item="${at}">${head}${escapeHtml(text)}</p>`;
}

/** 按顿号、分号切词，括号里的顿号不切。 */
export function skillTokens(text: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
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
  const { label, text } = skillLine(item);
  const tokens = skillTokens(text);
  if (tokens.some((t) => t.length > TAG_MAX_LENGTH || /[，。,]/.test(t))) return renderSkillLine(item, at);
  const tags = tokens.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(" ");
  const head = label ? `<span class="item-title">${escapeHtml(label)}</span>` : "";
  return `<p class="skill-line" data-item="${at}">${head}<span class="tags">${tags}</span></p>`;
}

function renderSection(section: ResumeSection, index: number, spec: TemplateSpec): string {
  if (section.items.length === 0) return "";
  const skills = spec.skills === "tags" ? renderSkillTags : renderSkillLine;
  const render = section.kind === "skills" ? skills : renderItem;
  const items = section.items.map((item, i) => render(item, `${index}-${i}`)).join("");
  return `<section data-kind="${section.kind}" data-section="${index}"><h2>${escapeHtml(section.title)}</h2><div class="sec-body">${items}</div></section>`;
}

export interface ResumeFragment {
  css: string;
  html: string;
  margin: string;
  style: ResumeStyle;
}

/** 不含 html/body 的简历片段：PDF 包成整页文档，网页预览直接挂进 shadow DOM，两边同源。 */
export function renderFragment(content: ResumeContent, options: RenderOptions = {}): ResumeFragment {
  const style = resolveRenderStyle(options);
  const spec = TEMPLATES[style.template];
  const { name, contacts, summary } = content.basics;
  const contactHtml = contacts.length
    ? `<div class="contacts">${contacts.map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</div>`
    : "";
  const summaryHtml = summary ? `<p class="summary">${escapeHtml(summary)}</p>` : "";
  const sections = content.sections.map((s, i) => renderSection(s, i, spec)).join("\n");
  const html = `<div class="resume t-${style.template}" style="--accent: ${ACCENT_INFO[style.accent].hex}">
<header class="head"><h1>${escapeHtml(name)}</h1>${contactHtml}${summaryHtml}</header>
${sections}
</div>`;
  return { css: BASE_CSS + scopeCss(spec.css), html, margin: spec.margin, style };
}

export function renderHtml(content: ResumeContent, options: RenderOptions = {}): string {
  const { css, html, margin } = renderFragment(content, options);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(content.basics.name)} - 简历</title>
<style>@page { size: A4; margin: ${margin}; }
html, body { margin: 0; padding: 0; background: #fff; }${css}</style>
</head>
<body>
${html}
</body>
</html>
`;
}
