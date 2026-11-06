// 手写的参考模板：10 种风格，用虚构内容渲染。故意不用我们自己的 DOM 结构，模拟「别处看到的模板截图」。
import type { ResumeContent, ResumeItem, ResumeSection } from "@talksume/core";
import { evalResume } from "./fixture.ts";

export interface Ref {
  id: string;
  title: string;
  /** 给版式检查用的预期特征。 */
  traits: { columns: 1 | 2; headerBand: boolean; accent: string; dark?: boolean };
  html: string;
}

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
const R: ResumeContent = evalResume;
const sec = (...kinds: string[]) => R.sections.filter((s) => kinds.includes(s.kind));
const bullets = (it: ResumeItem, cls = "") =>
  it.bullets.length
    ? `<ul class="${cls}">${it.bullets.map((b) => `<li>${b.lead ? `<b>${esc(b.lead)}</b>：` : ""}${esc(b.text.replace(/\*\*/g, ""))}</li>`).join("")}</ul>`
    : "";
const skillText = (it: ResumeItem) =>
  it.bullets.map((b) => `${b.lead ? `${esc(b.lead)} ` : ""}${esc(b.text)}`).join("；");
const head = (it: ResumeItem) =>
  `<div class="row"><span class="t">${esc(it.heading)}${it.subheading ? `<span class="s"> · ${esc(it.subheading)}</span>` : ""}</span><span class="p">${esc(it.period ?? "")}</span></div>`;
const items = (s: ResumeSection, cls = "") =>
  s.items.map((it) => `<div class="item ${cls}">${head(it)}${bullets(it)}</div>`).join("");
const skills = (s: ResumeSection) =>
  s.items.map((it) => `<p class="sk"><b>${esc(it.heading)}</b>　${skillText(it)}</p>`).join("");
const tags = (s: ResumeSection) =>
  s.items
    .map(
      (it) =>
        `<p class="sk"><b>${esc(it.heading)}</b> ${it.bullets
          .flatMap((b) => b.text.split(/[、；]/))
          .map((t) => `<span class="tag">${esc(t.trim())}</span>`)
          .join("")}</p>`,
    )
    .join("");
const contacts = R.basics.contacts.join("　|　");
const page = (css: string, body: string) =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}html,body{background:#fff}
body{width:210mm;min-height:297mm;font:9.6pt/1.55 "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;color:#333;-webkit-print-color-adjust:exact}
ul{list-style:none}.row{display:flex;justify-content:space-between;align-items:baseline}
${css}</style></head><body>${body}</body></html>`;

const refs: Ref[] = [];

refs.push({
  id: "sidebar-navy",
  title: "左侧深蓝侧栏 + 圆形照片位",
  traits: { columns: 2, headerBand: false, accent: "#1e3a5f", dark: true },
  html: page(
    `body{display:flex}.l{width:66mm;background:#1e3a5f;color:#e8eef7;padding:14mm 8mm;min-height:297mm}
.photo{width:30mm;height:30mm;border-radius:50%;background:#7b93b3;margin:0 auto 6mm}
.l h1{font-size:19pt;text-align:center;letter-spacing:.2em;color:#fff}.l .hl{text-align:center;font-size:9pt;opacity:.85;margin:2mm 0 6mm}
.l h2{font-size:10.5pt;color:#fff;border-bottom:1px solid #4d6a92;padding-bottom:1mm;margin:5mm 0 2mm;letter-spacing:.15em}
.l p{font-size:8.6pt;margin:1mm 0}.l .sk b{display:block;color:#a9c0de}.r{flex:1;padding:14mm 11mm}
.r h2{font-size:12pt;color:#1e3a5f;margin:0 0 3mm;padding-left:3mm;border-left:3mm solid #1e3a5f;letter-spacing:.1em}
.r .sec{margin-bottom:5mm}.item{margin-bottom:3mm}.t{font-weight:700;color:#111}.p{color:#666;font-size:8.8pt}li{padding-left:4mm;position:relative}li:before{content:"";position:absolute;left:0;top:2.4mm;width:1.4mm;height:1.4mm;background:#1e3a5f;border-radius:50%}`,
    `<div class="l"><div class="photo"></div><h1>${esc(R.basics.name)}</h1><p class="hl">求职意向：后端开发工程师</p>
<h2>联系方式</h2>${R.basics.contacts.map((c) => `<p>${esc(c)}</p>`).join("")}
${sec("education")
  .map(
    (s) =>
      `<h2>${esc(s.title)}</h2>${s.items.map((it) => `<p><b style="color:#fff">${esc(it.heading)}</b><br>${esc(it.subheading ?? "")}<br>${esc(it.period ?? "")}</p>`).join("")}`,
  )
  .join("")}
${sec("skills")
  .map((s) => `<h2>${esc(s.title)}</h2>${skills(s)}`)
  .join("")}</div>
<div class="r">${sec("experiences", "projects", "awards")
      .map((s) => `<div class="sec"><h2>${esc(s.title)}</h2>${items(s)}</div>`)
      .join("")}</div>`,
  ),
});

refs.push({
  id: "band-gradient",
  title: "顶部渐变色块抬头 + 圆角标签技能",
  traits: { columns: 1, headerBand: true, accent: "#0f766e" },
  html: page(
    `.h{background:linear-gradient(100deg,#0f766e,#14b8a6);color:#fff;padding:12mm 14mm 9mm;display:flex;justify-content:space-between;align-items:flex-end}
.h h1{font-size:23pt;letter-spacing:.12em}.h p{font-size:9.4pt;opacity:.92;margin-top:1.5mm}.h .c{text-align:right;font-size:9pt;line-height:1.7}
.m{padding:7mm 14mm}.m h2{display:inline-block;background:#0f766e;color:#fff;font-size:10pt;padding:.6mm 4mm;border-radius:0 4mm 4mm 0;margin:4mm 0 2.5mm -14mm;padding-left:14mm;letter-spacing:.2em}
.t{font-weight:700;color:#0b4f49}.p{color:#777;font-size:8.8pt}.item{margin-bottom:2.6mm}li{padding-left:4mm;position:relative}li:before{content:"▸";position:absolute;left:0;color:#0f766e}
.tag{display:inline-block;background:#e2f5f2;color:#0b4f49;border-radius:10px;padding:0 3mm;margin:0 1.5mm 1.5mm 0;font-size:8.8pt}.sk b{color:#0b4f49;margin-right:2mm}`,
    `<div class="h"><div><h1>${esc(R.basics.name)}</h1><p>${esc(R.basics.headline ?? "")}</p></div><div class="c">${R.basics.contacts.map((c) => `<div>${esc(c)}</div>`).join("")}</div></div>
<div class="m">${R.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.kind === "skills" ? tags(s) : items(s)}`).join("")}</div>`,
  ),
});

refs.push({
  id: "serif-minimal",
  title: "极简黑白衬线，居中姓名，细线分区",
  traits: { columns: 1, headerBand: false, accent: "#111111" },
  html: page(
    `body{font-family:"Songti SC","Noto Serif SC","SimSun",serif;padding:14mm 17mm;color:#222}
.h{text-align:center;padding-bottom:4mm;border-bottom:.6pt solid #222}.h h1{font-size:22pt;letter-spacing:.35em;font-weight:600}
.h p{margin-top:2mm;font-size:9pt;color:#555;letter-spacing:.05em}h2{font-size:10.6pt;letter-spacing:.5em;text-align:center;margin:5mm 0 2.5mm;font-weight:600;display:flex;align-items:center;gap:3mm}
h2:before,h2:after{content:"";flex:1;border-top:.4pt solid #888}.t{font-weight:700}.p{font-size:9pt}.s{color:#444}.item{margin-bottom:2.8mm}li{padding-left:4mm;position:relative;text-align:justify}li:before{content:"–";position:absolute;left:0}.sk{margin:.8mm 0}`,
    `<div class="h"><h1>${esc(R.basics.name)}</h1><p>${esc(contacts)}</p></div>${R.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.kind === "skills" ? skills(s) : items(s)}`).join("")}`,
  ),
});

refs.push({
  id: "timeline-teal",
  title: "时间线竖线 + 圆点，青色点缀",
  traits: { columns: 1, headerBand: false, accent: "#0891b2" },
  html: page(
    `body{padding:13mm 15mm}.h{display:flex;justify-content:space-between;align-items:center;border-bottom:3pt solid #0891b2;padding-bottom:4mm}
.h h1{font-size:22pt;color:#0e4c5e}.h p{color:#0891b2;font-weight:600;margin-top:1mm}.h .c{font-size:8.8pt;color:#555;text-align:right;line-height:1.7}
h2{font-size:11pt;color:#0891b2;margin:5mm 0 2.5mm;letter-spacing:.12em;text-transform:uppercase}.tl{border-left:1.5pt solid #bde4ee;margin-left:2mm;padding-left:5mm}
.item{position:relative;margin-bottom:3mm}.item:before{content:"";position:absolute;left:-6.6mm;top:1.6mm;width:2.4mm;height:2.4mm;border-radius:50%;background:#fff;border:1.5pt solid #0891b2}
.t{font-weight:700;color:#0e4c5e}.p{color:#0891b2;font-size:8.8pt;font-weight:600}li{padding-left:3.5mm;position:relative}li:before{content:"·";position:absolute;left:0;font-weight:900;color:#0891b2}.sk{margin:.8mm 0}.sk b{color:#0e4c5e}`,
    `<div class="h"><div><h1>${esc(R.basics.name)}</h1><p>${esc(R.basics.headline?.split("·")[1]?.trim() ?? "后端开发工程师")}</p></div><div class="c">${R.basics.contacts.map((c) => `<div>${esc(c)}</div>`).join("")}</div></div>
${R.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.kind === "skills" ? skills(s) : `<div class="tl">${items(s)}</div>`}`).join("")}`,
  ),
});

refs.push({
  id: "warm-cards",
  title: "暖橙色卡片风：圆底标题、浅底圆角卡片",
  traits: { columns: 1, headerBand: false, accent: "#ea580c" },
  html: page(
    `body{padding:12mm 14mm;background:#fffaf5}.h{display:flex;gap:6mm;align-items:center;margin-bottom:5mm}.photo{width:24mm;height:24mm;border-radius:6mm;background:#fdba74}
.h h1{font-size:21pt;color:#9a3412}.h p{color:#c2410c;margin-top:1mm}.h .c{margin-left:auto;font-size:8.8pt;color:#7c5a48;line-height:1.7;text-align:right}
h2{display:flex;align-items:center;gap:2.5mm;font-size:11pt;color:#9a3412;margin:4mm 0 2mm}h2:before{content:"";width:5mm;height:5mm;border-radius:50%;background:#ea580c;box-shadow:inset 0 0 0 1.2mm #fed7aa}
.item{background:#fff;border:1px solid #fed7aa;border-radius:3mm;padding:2.6mm 4mm;margin-bottom:2.4mm}.t{font-weight:700;color:#7c2d12}.p{color:#c2410c;font-size:8.8pt}li{padding-left:3.5mm;position:relative}li:before{content:"";position:absolute;left:0;top:2.3mm;width:1.4mm;height:1.4mm;background:#ea580c;border-radius:50%}
.tag{display:inline-block;background:#ffedd5;color:#9a3412;border-radius:2mm;padding:0 2.5mm;margin:0 1.5mm 1.5mm 0;font-size:8.8pt}.sk b{color:#9a3412;margin-right:2mm}`,
    `<div class="h"><div class="photo"></div><div><h1>${esc(R.basics.name)}</h1><p>${esc(R.basics.headline ?? "")}</p></div><div class="c">${R.basics.contacts.map((c) => `<div>${esc(c)}</div>`).join("")}</div></div>
${R.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.kind === "skills" ? tags(s) : items(s)}`).join("")}`,
  ),
});

refs.push({
  id: "retro-double",
  title: "复古酒红宋体，双线分隔与菱形装饰",
  traits: { columns: 1, headerBand: false, accent: "#7f1d1d" },
  html: page(
    `body{font-family:"Songti SC","Noto Serif SC",serif;padding:11mm 15mm;color:#2b2020}.frame{border:2pt double #7f1d1d;padding:9mm 10mm;min-height:275mm}
.h{text-align:center}.h h1{font-size:23pt;color:#7f1d1d;letter-spacing:.3em}.h p{margin-top:2mm;font-size:9pt;color:#5b3a3a}.orn{text-align:center;color:#7f1d1d;letter-spacing:1em;margin:2mm 0 1mm;font-size:8pt}
h2{font-size:11pt;color:#7f1d1d;text-align:center;letter-spacing:.4em;margin:4.5mm 0 2.5mm;padding:1mm 0;border-top:.8pt solid #7f1d1d;border-bottom:.8pt solid #7f1d1d}
.t{font-weight:700;color:#4a1414}.p{font-size:9pt;color:#7f1d1d}.item{margin-bottom:2.6mm}li{padding-left:4mm;position:relative}li:before{content:"◆";font-size:5pt;position:absolute;left:0;top:1.2mm;color:#7f1d1d}.sk{margin:.8mm 0}.sk b{color:#4a1414}`,
    `<div class="frame"><div class="h"><h1>${esc(R.basics.name)}</h1><div class="orn">◆ ◆ ◆</div><p>${esc(contacts)}</p></div>${R.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.kind === "skills" ? skills(s) : items(s)}`).join("")}</div>`,
  ),
});

refs.push({
  id: "fresh-green-bar",
  title: "清新绿：标题左色条、右上照片位、进度式技能",
  traits: { columns: 1, headerBand: false, accent: "#16a34a" },
  html: page(
    `body{padding:12mm 15mm}.h{display:flex;justify-content:space-between;align-items:center;padding-bottom:4mm;border-bottom:1pt solid #bbf7d0}.h h1{font-size:22pt;color:#14532d}
.h p{color:#16a34a;font-weight:600;margin-top:1mm}.h .c{font-size:8.8pt;color:#555;margin-top:2mm}.photo{width:26mm;height:34mm;background:#dcfce7;border:1pt solid #86efac}
h2{font-size:11pt;color:#14532d;margin:4.5mm 0 2.5mm;padding-left:3mm;border-left:2.4mm solid #16a34a;line-height:1.1}.t{font-weight:700;color:#14532d}.p{color:#666;font-size:8.8pt}.item{margin-bottom:2.6mm}
li{padding-left:3.5mm;position:relative}li:before{content:"";position:absolute;left:0;top:2.2mm;width:1.6mm;height:1.6mm;background:#16a34a}.sk{display:flex;align-items:center;gap:3mm;margin:1mm 0}.sk b{width:22mm;color:#14532d}
.bar{flex:0 0 38mm;height:2mm;background:#dcfce7;border-radius:1mm}.bar i{display:block;height:100%;background:#16a34a;border-radius:1mm}.sk span{font-size:8.8pt;color:#555}`,
    `<div class="h"><div><h1>${esc(R.basics.name)}</h1><p>${esc(R.basics.headline?.split("·")[1]?.trim() ?? "后端开发工程师")}</p><div class="c">${esc(contacts)}</div></div><div class="photo"></div></div>
${R.sections
  .map(
    (s) =>
      `<h2>${esc(s.title)}</h2>${s.kind === "skills" ? s.items.map((it, i) => `<div class="sk"><b>${esc(it.heading)}</b><div class="bar"><i style="width:${90 - i * 12}%"></i></div><span>${skillText(it)}</span></div>`).join("") : items(s)}`,
  )
  .join("")}`,
  ),
});

refs.push({
  id: "dark-gold",
  title: "黑金：黑色抬头带金色文字，金线标题",
  traits: { columns: 1, headerBand: true, accent: "#b8892b", dark: true },
  html: page(
    `.h{background:#161616;color:#e9c46a;padding:13mm 15mm 8mm}.h h1{font-size:24pt;letter-spacing:.2em;font-weight:600}.h p{color:#cfcfcf;margin-top:2mm;font-size:9.2pt}.h .c{margin-top:2mm;color:#e9c46a;font-size:8.8pt;letter-spacing:.05em}
.gold{height:2mm;background:linear-gradient(90deg,#b8892b,#f1d78c,#b8892b)}.m{padding:6mm 15mm}h2{font-size:10.6pt;color:#161616;margin:4.5mm 0 2.5mm;padding-bottom:1mm;border-bottom:1.4pt solid #b8892b;letter-spacing:.2em}
.t{font-weight:700;color:#161616}.p{color:#8a6a1e;font-size:8.8pt}.item{margin-bottom:2.6mm}li{padding-left:4mm;position:relative}li:before{content:"◆";font-size:5pt;position:absolute;left:0;top:1.3mm;color:#b8892b}.sk b{color:#161616}.sk{margin:.8mm 0}`,
    `<div class="h"><h1>${esc(R.basics.name)}</h1><p>${esc(R.basics.headline ?? "")}</p><div class="c">${esc(contacts)}</div></div><div class="gold"></div>
<div class="m">${R.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.kind === "skills" ? skills(s) : items(s)}`).join("")}</div>`,
  ),
});

refs.push({
  id: "purple-pill",
  title: "紫色渐变标题胶囊 + 浅紫分区底",
  traits: { columns: 1, headerBand: false, accent: "#7c3aed" },
  html: page(
    `body{padding:12mm 14mm}.h{text-align:center}.h h1{font-size:23pt;color:#4c1d95;letter-spacing:.15em}.h p{color:#7c3aed;margin-top:1mm;font-weight:600}.h .c{margin-top:1.5mm;font-size:8.8pt;color:#666}
h2{display:inline-block;background:linear-gradient(90deg,#7c3aed,#a78bfa);color:#fff;font-size:10pt;padding:.8mm 6mm;border-radius:5mm;margin:5mm 0 2.5mm;letter-spacing:.2em}
.sec{background:#f5f3ff;border-radius:3mm;padding:2mm 5mm 3mm;margin-bottom:1mm}.t{font-weight:700;color:#4c1d95}.p{color:#7c3aed;font-size:8.8pt}.item{margin-bottom:2.4mm}li{padding-left:3.5mm;position:relative}li:before{content:"";position:absolute;left:0;top:2.2mm;width:1.5mm;height:1.5mm;border-radius:50%;background:#7c3aed}
.tag{display:inline-block;border:1px solid #c4b5fd;color:#5b21b6;background:#fff;border-radius:2mm;padding:0 2.5mm;margin:0 1.5mm 1.5mm 0;font-size:8.8pt}.sk b{color:#4c1d95;margin-right:2mm}`,
    `<div class="h"><h1>${esc(R.basics.name)}</h1><p>${esc(R.basics.headline?.split("·")[1]?.trim() ?? "后端开发工程师")}</p><div class="c">${esc(contacts)}</div></div>
${R.sections.map((s) => `<div style="text-align:left"><h2>${esc(s.title)}</h2></div><div class="sec">${s.kind === "skills" ? tags(s) : items(s)}</div>`).join("")}`,
  ),
});

refs.push({
  id: "tech-mono",
  title: "技术风：等宽抬头、边框标签、左对齐标题前缀",
  traits: { columns: 1, headerBand: false, accent: "#0ea5e9" },
  html: page(
    `body{padding:12mm 15mm}.h{border:1pt solid #0ea5e9;padding:5mm 6mm;border-radius:2mm;display:flex;justify-content:space-between;align-items:center}
.h h1{font:700 21pt "SF Mono",Menlo,Consolas,monospace;color:#0c4a6e}.h h1:before{content:"> ";color:#0ea5e9}.h p{font:9pt Menlo,Consolas,monospace;color:#0369a1;margin-top:1mm}.h .c{font:8.6pt Menlo,Consolas,monospace;color:#475569;text-align:right;line-height:1.7}
h2{font:700 10.4pt Menlo,Consolas,monospace;color:#0ea5e9;margin:5mm 0 2.4mm}h2:before{content:"## ";color:#94a3b8}.t{font-weight:700;color:#0f172a}.p{font:8.6pt Menlo,Consolas,monospace;color:#64748b}.item{margin-bottom:2.6mm}
li{padding-left:4mm;position:relative}li:before{content:"›";position:absolute;left:0;color:#0ea5e9;font-weight:900}.tag{display:inline-block;border:1px solid #7dd3fc;color:#0369a1;border-radius:1mm;padding:0 2mm;margin:0 1.5mm 1.5mm 0;font:8.4pt Menlo,Consolas,monospace}.sk b{color:#0f172a;margin-right:2mm}`,
    `<div class="h"><div><h1>${esc(R.basics.name)}</h1><p>${esc(R.basics.headline?.split("·")[1]?.trim() ?? "后端开发工程师")}</p></div><div class="c">${R.basics.contacts.map((c) => `<div>${esc(c)}</div>`).join("")}</div></div>
${R.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.kind === "skills" ? tags(s) : items(s)}`).join("")}`,
  ),
});

export const REFS: readonly Ref[] = refs;
