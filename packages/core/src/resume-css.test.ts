import { describe, expect, it } from "vitest";
import { expandResumeCss, fontsUsedBy, sanitizeResumeCss } from "./resume-css.ts";

const ok = (css: string) => {
  const r = sanitizeResumeCss(css);
  if (!r.ok) throw new Error(r.errors.join("；"));
  return r.css;
};
const errors = (css: string) => {
  const r = sanitizeResumeCss(css);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors.join("；");
};

describe("sanitizeResumeCss 接受", () => {
  it("常见装饰：选择器自动加 .resume 前缀，值规范化", () => {
    const css = ok(`
      .head { background: linear-gradient(90deg, #166534 0%, rgba(22,101,52,.6) 100%); padding: 10mm 8mm; border-radius: 3pt; }
      h2 { font-family: song; color: var(--accent); border-bottom: 0.75pt solid #166534; letter-spacing: 0.1em }
      section[data-kind="skills"] .tag { background-color: var(--accent-soft); border-radius: 2pt }
      .contacts span[data-k="phone"]::before { content: ""; display: inline-block; width: 10pt; height: 10pt; margin-right: 3pt;
        background-color: var(--accent); mask: asset(icon-phone) center / contain no-repeat; }
      .item:nth-child(2n+1) .item-title { color: #111827 }
    `);
    expect(css).toContain(".resume.resume .head{");
    expect(css).toContain('.resume.resume section[data-kind="skills"] .tag{');
    expect(css).toContain("::before");
    expect(css).toContain("asset(icon-phone)");
    expect(css).not.toMatch(/url\(/i);
  });

  it("多个选择器、:before 单冒号写法也收", () => {
    const css = ok(
      `.head h1, .head .headline { color: #111 } h2:before { content: ""; display: block; width: 3pt }`,
    );
    expect(css).toContain(".resume.resume .head h1,.resume.resume .head .headline{");
    expect(css).toContain("h2::before");
  });

  it("重复归一化不再叠加 .resume 前缀，用户写了 .resume 也一样", () => {
    let css = ok(`
      .head { color: #111 }
      h2 { letter-spacing: 1px }
      .resume .head, .resume .item { color: #222 }
      .resume.resume .item { margin-top: 2pt }
    `);
    for (let i = 0; i < 3; i++) {
      const next = ok(css);
      expect(next).toBe(css);
      css = next;
    }
    expect(css).not.toContain(".resume.resume.resume");
    expect(css).toContain(".resume.resume .head{");
    expect(css).toContain(".resume.resume .item{");
  });

  it(".photo 可以显示并用占位图", () => {
    const css = ok(
      `.photo { display: block; position: absolute; right: 10mm; top: 8mm; width: 24mm; height: 32mm; background: asset(photo-placeholder) center / cover no-repeat }`,
    );
    expect(css).toContain("asset(photo-placeholder)");
  });
});

describe("sanitizeResumeCss 拒绝", () => {
  const dangerous: [string, string][] = [
    ["url()", ".head { background: url(https://evil.example.com/a.png) }"],
    ["带引号 url", '.head { background-image: url("http://127.0.0.1:8000/x") }'],
    ["大写 URL", ".head { background: URL(x) }"],
    ["转义拆开的 url", ".head { background: \\75rl(http://a.example.com) }"],
    ["@import", "@import url(http://a.example.com/x.css); .head { color: red }"],
    ["@import 字符串", '@import "http://a.example.com/x.css"; .head { color: red }'],
    [
      "@font-face",
      "@font-face { font-family: x; src: url(http://a.example.com/f.woff) } .head { color: red }",
    ],
    ["@media", "@media print { .head { color: red } }"],
    ["image-set", '.head { background-image: image-set("a.png" 1x) }'],
    ["-webkit-image-set", '.head { background-image: -webkit-image-set("a.png" 1x) }'],
    ["cross-fade", ".head { background-image: cross-fade(red, blue) }"],
    ["attr()", ".head::before { content: attr(data-k) }"],
    ["content 插入文字", '.head::before { content: "兼职" }'],
    ["content counter", ".head::before { content: counter(x) }"],
    ["expression", ".head { width: expression(alert(1)) }"],
    ["behavior", ".head { behavior: url(x.htc) }"],
    ["-moz-binding", ".head { -moz-binding: url(x) }"],
    ["自定义属性", ".head { --x: 1 }"],
    ["!important", ".head { color: red !important }"],
    ["body 选择器", "body { background: red }"],
    ["html 选择器", "html { background: red }"],
    ["通配符", "* { color: red }"],
    ["非白名单类", ".admin-panel { color: red }"],
    ["id 选择器", "#x { color: red }"],
    ["属性选择器取内容", '.head[title^="a"] { color: red }'],
    ["伪类 :has", ".head:has(h1) { color: red }"],
    ["伪类 :not", ".head:not(.x) { color: red }"],
    ["伪元素 ::first-line", ".head::first-line { color: red }"],
    ["前面伪元素", ".head::before .x { color: red }"],
    ["隐藏内容", ".summary { display: none }"],
    ["隐藏联系方式", ".contacts { display: none }"],
    ["visibility", ".summary { visibility: hidden }"],
    ["opacity 0", ".summary { opacity: 0 }"],
    ["字太小", ".summary { font-size: 2pt }"],
    ["字太小 em", ".summary { font-size: 0.2em }"],
    ["内容元素绝对定位", ".summary { position: absolute; left: -9999mm }"],
    ["fixed 定位", ".photo { position: fixed }"],
    ["overflow", ".item { overflow: hidden; height: 0 }"],
    ["text-indent", ".summary { text-indent: -999px }"],
    ["transform", ".head { transform: translateX(-9999px) }"],
    ["color: transparent", ".summary { color: transparent }"],
    ["order", ".item { order: 5 }"],
    ["未知字体", ".head { font-family: Arial }"],
    ["系统字体名", '.head { font-family: "Helvetica Neue", sans-serif }'],
    ["未知素材", ".head { background: asset(evil) }"],
    ["asset 用在 color", ".head { color: asset(icon-dot) }"],
    ["var 引用未知变量", ".head { color: var(--evil) }"],
    ["未知函数", ".head { width: env(safe-area-inset-top) }"],
    ["视口单位", ".head { width: 100vw }"],
    ["超大数值", ".head { width: 99999mm }"],
    ["语法错误", ".head { color red }"],
    ["花括号没闭合", ".head { color: red"],
    ["闭合 style 标签", ".head { color: red } </style><script>alert(1)</script>"],
    ["空", "   "],
  ];
  for (const [name, css] of dangerous) {
    it(name, () => {
      expect(errors(css).length).toBeGreaterThan(0);
    });
  }

  it("写错的规则整条丢弃，其余保留，并说明丢了什么", () => {
    const r = sanitizeResumeCss(
      ".head { color: #111 } .nope { color: red } .item-title { font-family: Arial } h2 { transform: rotate(3deg) }",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.css).toContain(".head{");
      expect(r.css).not.toContain("Arial");
      expect(r.css).not.toContain("transform");
      expect(r.dropped).toHaveLength(3);
      expect(r.dropped.join("\n")).toContain(".nope");
    }
  });

  it("-webkit-mask 当作 mask", () => {
    const r = sanitizeResumeCss(
      '.head::before { content: ""; -webkit-mask: asset(icon-dot) center/contain no-repeat; background: #111 }',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.css).toContain("mask:asset(icon-dot)");
  });

  it("夹带 url() 或 @import：整份作废，好的规则也不留", () => {
    for (const bad of [".item { background: url(http://a.example.com/x) }", "@import 'x.css';"]) {
      const r = sanitizeResumeCss(`.head { color: #111 } ${bad}`);
      expect(r.ok).toBe(false);
    }
  });

  it("一处出错整份作废，错误指明哪里", () => {
    const r = sanitizeResumeCss(
      ".head { color: #111 } .item-title { font-family: Arial; background: url(x) }",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toContain("Arial");
      expect(r.errors.join("\n")).toContain("url()");
    }
  });

  it("超长拒绝", () => {
    expect(errors(`.head { color: red }${" ".repeat(13000)}`)).toContain("超过");
  });
});

describe("expandResumeCss", () => {
  it("asset 换成内置 SVG 的 data URI，不含外链", () => {
    const css = expandResumeCss(
      ok(
        '.contacts span::before { content: ""; mask: asset(icon-mail) center/contain no-repeat; background: var(--accent) }',
      ),
    );
    const urls = css.match(/url\(([^)]*(?:\\\)[^)]*)*)\)/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(/^url\(data:image\/svg\+xml,/);
    expect(css).not.toMatch(/https?:/);
    expect(css).not.toContain("<");
  });

  it("字体名换成字体栈", () => {
    const canonical = ok("h2 { font-family: song } .item-title { font-family: hei, sans-serif }");
    expect(fontsUsedBy(canonical).sort()).toEqual(["hei", "song"]);
    const css = expandResumeCss(canonical);
    expect(css).toContain("Noto Serif SC");
    expect(css).toContain("Noto Sans SC");
  });
});

describe("装饰层（伪元素）", () => {
  it("伪元素可以用 clip-path、transform、编号和符号", () => {
    const css = ok(`
      .head::after { content: ""; position: absolute; top: 0; right: 0; width: 40mm; height: 12mm; background-color: var(--accent);
        clip-path: polygon(0 0, 100% 0, 100% 100%, 12% 100%); z-index: -1 }
      h2::before { content: "01"; display: inline-block; color: var(--accent); transform: rotate(-4deg); transform-origin: left center }
      .item-title::before { content: "◆"; margin-right: 3pt; color: var(--accent) }
      section h2::after { content: counter(sec, decimal-leading-zero) }
      .photo::after { content: ""; clip-path: circle(50% at 50% 50%) }
    `);
    expect(css).toContain("clip-path:polygon(");
    expect(css).toContain("transform:rotate(-4deg)");
    expect(css).toContain('content:"01"');
  });

  const cases: [string, string][] = [
    ["正文元素 transform", ".item { transform: rotate(2deg) }"],
    ["正文元素 clip-path", ".summary { clip-path: circle(50%) }"],
    ["伪元素 content 任意文字", '.head::before { content: "已录用" }'],
    ["伪元素 content 超出编号", '.head::before { content: "13" }'],
    ["非伪元素写编号", '.head { content: "01" }'],
    ["counter 用别的计数器", ".head::before { content: counter(x) }"],
    ["clip-path url", ".head::after { content: ''; clip-path: url(#x) }"],
    ["clip-path 不认识的函数", ".head::after { content: ''; clip-path: path('M0 0') }"],
    ["transform 不认识的函数", ".head::after { content: ''; transform: matrix(1,0,0,1,0,0) }"],
    ["角度过大", ".head::after { content: ''; transform: rotate(9999deg) }"],
    ["filter", ".head::after { content: ''; filter: blur(4px) }"],
  ];
  for (const [name, css] of cases) {
    it(`拒绝：${name}`, () => {
      expect(errors(css).length).toBeGreaterThan(0);
    });
  }
});
