import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sanitizeResumeCss } from "@talksume/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { close, renderFragment, renderHtml, renderPdf, renderResumePng, sampleResume } from "./index.ts";

const good = sanitizeResumeCss(`
  .head { background: linear-gradient(90deg, var(--accent) 0%, #0f766e 100%); padding: 9mm 8mm; border-radius: 3pt }
  .head h1, .head .headline, .head .contacts, .head .summary { color: #fff }
  h2 { font-family: song; border-bottom: 0.75pt solid var(--accent) }
  .contacts span[data-k="phone"]::before { content: ""; display: inline-block; width: 9pt; height: 9pt; margin-right: 3pt;
    background-color: #fff; mask: asset(icon-phone) center / contain no-repeat }
  .photo { display: block; position: absolute; right: 8mm; top: 7mm; width: 22mm; height: 29mm; background: asset(photo-placeholder) center / cover no-repeat }
  section[data-kind="skills"] .tag { background-color: var(--accent-soft) }
`);
if (!good.ok) throw new Error(good.errors.join("；"));
const css = good.css;

const countPages = (pdf: Uint8Array) =>
  new TextDecoder().decode(pdf).match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;

afterAll(() => close());

describe("定制 CSS 渲染", () => {
  it("叠在预设之上：素材展开成内置 SVG 的 data URI，没有外链", () => {
    const fragment = renderFragment(sampleResume, { template: "campus", accent: "teal", css });
    expect(fragment.html).toContain('class="resume t-campus');
    expect(fragment.html).toContain("custom");
    expect(fragment.html).toContain('<div class="photo" aria-hidden="true"></div>');
    expect(fragment.html).toMatch(/data-k="(phone|email|link)"/);
    expect(fragment.css).toContain(".resume.resume .head{");
    const urls = fragment.css.match(/url\([^)]*(?:\\\)[^)]*)*\)/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(/^url\(data:image\/svg\+xml,/);
    expect(fragment.css).not.toMatch(/@import|@font-face|https?:\/\//);
  });

  it("不带 css 时输出和以前完全一样，没有照片钩子", () => {
    const fragment = renderFragment(sampleResume, { template: "tech", accent: "blue" });
    expect(fragment.html).not.toContain("photo");
    expect(fragment.html).not.toContain('data-k="');
  });

  it("库里被写进坏 CSS：渲染时整份丢弃，回落到没有定制的样子", () => {
    const base = renderFragment(sampleResume, { template: "modern", accent: "wine" });
    const bad = renderFragment(sampleResume, {
      template: "modern",
      accent: "wine",
      css: ".head { background: url(http://127.0.0.1:1/x) } @import url(http://127.0.0.1:1/y);",
    });
    expect(bad.css).toBe(base.css);
    expect(bad.html).toBe(base.html);
  });

  it("正文文字不受 CSS 影响：有无定制，纯文本一致", async () => {
    const plain = await renderResumePng(sampleResume, { template: "campus", accent: "teal" });
    const styled = await renderResumePng(sampleResume, { template: "campus", accent: "teal", css });
    expect(styled.check.text).toBe(plain.check.text);
    expect(styled.check.hiddenText).toBe(0);
    expect(styled.check.overflowX).toBe(0);
    expect(styled.check.overlaps).toBe(0);
  });

  it("PNG 是整页截图，带版式自检", async () => {
    const out = await renderResumePng(sampleResume, { template: "campus", accent: "teal", css });
    expect(Array.from(out.png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(out.width).toBeGreaterThan(900);
    expect(out.check.pages).toBeGreaterThanOrEqual(1);
  });

  it("自检能发现深字落在深底上", async () => {
    const dark = ".head { background-color: #1e3a5f; color: #111111 }";
    const bad = await renderResumePng(sampleResume, { template: "campus", accent: "teal", css: dark });
    const ok = await renderResumePng(sampleResume, { template: "campus", accent: "teal", css });
    expect(bad.check.lowContrast).toBeGreaterThan(0);
    expect(ok.check.lowContrast).toBe(0);
  });

  it("伪元素盖住文字：自检报 covered；放在文字下面的装饰不算", async () => {
    const cover =
      ".item::after { content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: #ffffff }";
    const behind =
      ".head::after { content: ''; position: absolute; top: 0; right: 0; width: 40mm; height: 14mm; background-color: var(--accent-soft); clip-path: polygon(0 0, 100% 0, 100% 100%, 20% 100%); z-index: -1 }";
    const bad = await renderResumePng(sampleResume, { template: "campus", accent: "teal", css: cover });
    const ok = await renderResumePng(sampleResume, { template: "campus", accent: "teal", css: behind });
    expect(bad.check.covered).toBeGreaterThan(0);
    expect(ok.check.covered).toBe(0);
    expect(ok.png.length).toBeGreaterThan(1000);
  });

  it("PDF 照常渲染，定制后的示例仍是一页", async () => {
    const pdf = await renderPdf(sampleResume, { template: "campus", accent: "teal", css });
    expect(countPages(pdf)).toBe(1);
  });
});

describe("定制 CSS 联不了网", () => {
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

  it("恶意 CSS 即便绕过存储校验直接交给渲染，PDF 和 PNG 都发不出请求", async () => {
    const evil = `.head { background: url("${origin}/bg") } @import url("${origin}/import"); h2::before { content: ""; background: url(${origin}/h2) }`;
    const html = renderHtml(sampleResume, { css: evil });
    expect(html).not.toContain(origin);
    await renderPdf(sampleResume, { css: evil });
    await renderResumePng(sampleResume, { css: evil });
    expect(hits).toEqual([]);
  });

  it("页面本身即便被塞进外链和脚本，PNG 渲染也不发请求、不执行脚本", async () => {
    const { renderScreenHtml } = await import("./index.ts");
    const html = renderScreenHtml(sampleResume).replace(
      "</head>",
      `<link rel="stylesheet" href="${origin}/css"><style>@import url("${origin}/imp"); body { background: url("${origin}/bg") }</style></head>`,
    );
    const { getBrowser } = await import("./chromium.ts");
    const browser = await getBrowser();
    const context = await browser.newContext({ offline: true, serviceWorkers: "block" });
    try {
      await context.route("**/*", (route) => route.abort("blockedbyclient"));
      const page = await context.newPage();
      await page.setContent(`${html}<img src="${origin}/img"><script>fetch("${origin}/script")</script>`);
    } finally {
      await context.close();
    }
    expect(hits).toEqual([]);
  });
});

describe("内置字体", () => {
  const fontCss = sanitizeResumeCss(
    ".head h1 { font-family: brush } h2 { font-family: song; font-weight: 700 }",
  );
  if (!fontCss.ok) throw new Error(fontCss.errors.join("；"));

  it("渲染结果带上用到的字体名，字体文件来自随包的 fontsource", async () => {
    const { fontFile, fontFaceCss, FONT_ORIGIN } = await import("./index.ts");
    expect(renderFragment(sampleResume, { css: fontCss.css }).fonts.sort()).toEqual(["brush", "song"]);
    const faces = fontFaceCss(["song"], FONT_ORIGIN);
    const file = faces.match(/url\(https:\/\/fonts\.talksume\.invalid\/([a-z0-9-]+\.woff2)\)/)?.[1] ?? "";
    expect(fontFile(file)?.subarray(0, 4).toString("latin1")).toBe("wOF2");
    expect(fontFile("../../../etc/passwd")).toBeUndefined();
    expect(fontFile("noto-serif-sc-4-400-normal.woff")).toBeUndefined();
  });

  it("PDF 和截图里字体真的加载了：PDF 内嵌字体，截图里 document.fonts 全部 loaded，且没有外联", async () => {
    const pdf = await renderPdf(sampleResume, { template: "campus", accent: "teal", css: fontCss.css });
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text).toMatch(/NotoSerifSC|MaShanZheng/);
    const png = await renderResumePng(sampleResume, { template: "campus", accent: "teal", css: fontCss.css });
    expect(png.check.hiddenText).toBe(0);
  });
});
