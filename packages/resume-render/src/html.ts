// 版式思路借鉴 career-ops (MIT) templates/cv-template.zh-minimal.html：单栏、禁用连字以保证 ATS 文本抽取
import { type ResumeContent, type ResumeItem, type ResumeSection, skillLine } from "@talksume/core";
import { DEFAULT_TEMPLATE, FONT_STACK_CSS, type RenderOptions } from "./types.ts";

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

const CAMPUS_CSS = `
@page { size: A4; margin: 12mm 15mm; }
* { box-sizing: border-box; margin: 0; padding: 0; font-variant-ligatures: none; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: ${FONT_STACK_CSS}; font-size: 9.5pt; line-height: 1.5; color: #1f2933; background: #fff; }
header { padding-bottom: 6px; margin-bottom: 4px; }
h1 { font-size: 22pt; line-height: 1.2; font-weight: 700; color: #111827; letter-spacing: 0.04em; }
.contacts { margin-top: 3px; color: #4b5563; font-size: 9pt; }
.contacts span + span::before { content: "|"; margin: 0 0.6em; color: #9ca3af; }
.summary { margin-top: 5px; color: #374151; }
section { margin-top: 9px; }
h2 { font-size: 11pt; font-weight: 700; color: #1d4e89; border-bottom: 1.2px solid #1d4e89; padding-bottom: 1px; margin-bottom: 4px; break-after: avoid; }
.item { margin-top: 5px; break-inside: avoid; }
.item-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; break-after: avoid; }
.item-title { font-weight: 700; color: #111827; }
.item-sub { margin-left: 0.8em; color: #4b5563; font-weight: 400; }
.item-period { flex: none; color: #4b5563; font-size: 9pt; white-space: nowrap; }
ul { margin: 2px 0 0 1.3em; padding: 0; }
li { margin-top: 1px; padding-left: 0.1em; }
.skill-line { margin-top: 2px; break-inside: avoid; }
`;

function renderItem(item: ResumeItem): string {
  const sub = item.subheading ? `<span class="item-sub">${escapeHtml(item.subheading)}</span>` : "";
  const period = item.period ? `<span class="item-period">${escapeHtml(item.period)}</span>` : "";
  const bullets = item.bullets.length
    ? `<ul>${item.bullets.map((b) => `<li>${escapeHtml(b.text)}</li>`).join("")}</ul>`
    : "";
  return `<div class="item"><div class="item-head"><div><span class="item-title">${escapeHtml(item.heading)}</span>${sub}</div>${period}</div>${bullets}</div>`;
}

function renderSkillLine(item: ResumeItem): string {
  const { label, text } = skillLine(item);
  const head = label ? `<span class="item-title">${escapeHtml(label)}：</span>` : "";
  return `<p class="skill-line">${head}${escapeHtml(text)}</p>`;
}

function renderSection(section: ResumeSection): string {
  if (section.items.length === 0) return "";
  const render = section.kind === "skills" ? renderSkillLine : renderItem;
  return `<section data-kind="${section.kind}"><h2>${escapeHtml(section.title)}</h2>${section.items.map(render).join("")}</section>`;
}

export function renderHtml(content: ResumeContent, options: RenderOptions = {}): string {
  const template = options.template ?? DEFAULT_TEMPLATE;
  if (template !== "campus") throw new Error(`未知简历模板: ${String(template)}`);
  const { name, contacts, summary } = content.basics;
  const contactHtml = contacts.length
    ? `<div class="contacts">${contacts.map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</div>`
    : "";
  const summaryHtml = summary ? `<p class="summary">${escapeHtml(summary)}</p>` : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(name)} - 简历</title>
<style>${CAMPUS_CSS}</style>
</head>
<body>
<header><h1>${escapeHtml(name)}</h1>${contactHtml}${summaryHtml}</header>
${content.sections.map(renderSection).join("\n")}
</body>
</html>
`;
}
