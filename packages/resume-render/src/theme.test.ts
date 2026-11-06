import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ResumeTheme } from "@talksume/core";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  close,
  htmlToPdf,
  renderDocx,
  renderFragment,
  renderHtml,
  renderPdf,
  sampleResume,
} from "./index.ts";

const theme: ResumeTheme = {
  name: "稳重深绿",
  accent: "#166534",
  headingColor: "#14532d",
  bodyFont: "sans",
  headingFont: "serif",
  header: "rule",
  headerAlign: "left",
  headingStyle: "underline",
  layout: "sidebar",
  bullet: "square",
  skills: "line",
  density: "auto",
};

const countPages = (pdf: Uint8Array) =>
  new TextDecoder().decode(pdf).match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;

afterAll(() => close());

describe("主题渲染", () => {
  it("颜色只以校验过的 hex 进内联变量，字体来自本地字体栈", () => {
    const { css, html, style } = renderFragment(sampleResume, { theme });
    expect(html).toContain("--accent: #166534");
    expect(html).toContain("--heading: #14532d");
    expect(css).toContain('"Source Han Serif SC"');
    expect(css).not.toMatch(/url\(|@import|@font-face/);
    expect(style.theme).toEqual(theme);
    expect(style).toMatchObject({ template: "tech", accent: "teal" });
  });

  it("两栏：教育、技能进侧栏且在 DOM 里排在正文前面", () => {
    const { html, css } = renderFragment(sampleResume, { theme });
    expect(css).toContain("grid-template-columns");
    const side = html.slice(html.indexOf('<aside class="side">'), html.indexOf('<div class="main">'));
    const main = html.slice(html.indexOf('<div class="main">'));
    expect(side).toContain('data-kind="education"');
    expect(side).toContain('data-kind="skills"');
    expect(side).not.toContain('data-kind="experiences"');
    expect(main).toContain('data-kind="experiences"');
    expect(html.indexOf('data-kind="education"')).toBeLessThan(html.indexOf('data-kind="experiences"'));
  });

  it("保留原始分区序号，预览高亮和溯源定位不受分栏影响", () => {
    const plain = renderFragment(sampleResume, {});
    const themed = renderFragment(sampleResume, { theme });
    const ids = (h: string) => [...h.matchAll(/data-item="([\d-]+)"/g)].map((m) => m[1]).sort();
    expect(ids(themed.html)).toEqual(ids(plain.html));
  });

  it.each([
    ["band", "headingStyle", "block", "background: var(--heading)"],
    ["plain", "headingStyle", "bar", "h2::before"],
    ["plain", "bullet", "dash", "width: 0.5em"],
    ["band", "skills", "tags", ".resume .tag"],
  ] as const)("字段落到 CSS：header=%s %s=%s", (header, key, value, needle) => {
    const { css } = renderFragment(sampleResume, { theme: { ...theme, header, [key]: value } });
    expect(css).toContain(needle);
    if (header === "band") expect(css).toContain(".resume .head { background: var(--accent)");
  });

  it("单栏不出现分栏结构；密度可以指定", () => {
    const { html, layout } = renderFragment(sampleResume, {
      theme: { ...theme, layout: "single", density: "compact" },
    });
    expect(html).not.toContain('class="cols"');
    expect(layout.density).toBe("compact");
  });

  it("坏主题回落到预设模板，不报错", () => {
    const bad = { ...theme, accent: "red; } * { display: none" } as unknown as ResumeTheme;
    const { html, style } = renderFragment(sampleResume, { template: "modern", accent: "wine", theme: bad });
    expect(style.theme).toBeUndefined();
    expect(html).toContain("t-modern");
    expect(html).not.toContain("display: none");
  });

  it("太浅的颜色在渲染时也会被加深", () => {
    const { html } = renderFragment(sampleResume, { theme: { ...theme, accent: "#fef08a" } });
    expect(html).not.toContain("#fef08a");
  });

  it("整页 HTML 带禁止外部资源的 CSP", () => {
    expect(renderHtml(sampleResume, { theme })).toContain("default-src 'none'");
  });

  it("Word 版用主题的颜色", async () => {
    const docx = await renderDocx(sampleResume, { theme });
    const xml = await (await JSZip.loadAsync(docx)).file("word/document.xml")?.async("string");
    expect(xml).toContain("166534");
  });
});

describe("主题 PDF", { timeout: 30_000 }, () => {
  let server: Server;
  let hits: string[];
  let origin: string;

  beforeAll(async () => {
    hits = [];
    server = createServer((req, res) => {
      hits.push(req.url ?? "");
      res.end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("两栏主题的示例简历仍是一页", async () => {
    expect(countPages(await renderPdf(sampleResume, { theme }))).toBe(1);
  });

  it("页面里即便混进外链，也一个请求都发不出去", async () => {
    const html = `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="${origin}/css">
<style>@import url("${origin}/import"); body { background: url("${origin}/bg"); }</style>
</head><body>
<img src="${origin}/img"><iframe src="${origin}/frame"></iframe>
<script>fetch("${origin}/script")</script>
</body></html>`;
    const pdf = await htmlToPdf(html);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(hits).toEqual([]);
  });
});
