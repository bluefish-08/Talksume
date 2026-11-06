import { describe, expect, it } from "vitest";
import {
  applyThemePatch,
  DEFAULT_RESUME_STYLE,
  fallbackPreset,
  resolveResumeStyle,
  styleFromDesign,
  themeFromPreset,
} from "./resume-style.ts";
import {
  colorName,
  contrastOnWhite,
  describeTheme,
  MIN_CONTRAST,
  type ResumeTheme,
  sanitizeTheme,
} from "./resume-theme.ts";

const theme: ResumeTheme = {
  name: "稳重深绿",
  accent: "#166534",
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

describe("主题校验", () => {
  it("合法主题原样通过，颜色统一小写", () => {
    const out = sanitizeTheme({ ...theme, accent: "#166534", headingColor: "#14532D" });
    expect(out?.theme).toEqual({ ...theme, headingColor: "#14532d" });
    expect(out?.notes).toEqual([]);
  });

  it.each([
    ["非 hex 颜色", { accent: "green" }],
    ["带 url 的颜色", { accent: "url(http://169.254.169.254/)" }],
    ["CSS 注入", { accent: "#166534; } body { display:none" }],
    ["3 位 hex", { accent: "#163" }],
    ["枚举外的值", { layout: "three-column" }],
    ["多余字段", { css: "h2 { color: red }" }],
    ["名字过长", { name: "一二三四五六七八九十一二三" }],
  ])("拒绝%s", (_label, patch) => {
    expect(sanitizeTheme({ ...theme, ...patch })).toBeNull();
  });

  it("太浅的颜色加深到白纸上可读，并说明调整", () => {
    const out = sanitizeTheme({ ...theme, accent: "#fde047", headingColor: "#a7f3d0" });
    expect(out).not.toBeNull();
    expect(contrastOnWhite(out?.theme.accent ?? "")).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrastOnWhite(out?.theme.headingColor ?? "")).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(out?.notes).toHaveLength(2);
    expect(out?.notes[0]).toContain("#fde047");
    expect(colorName(out?.theme.accent ?? "")).toMatch(/黄|橙/);
  });

  it("标题色和主色相同就不单独存", () => {
    expect(sanitizeTheme({ ...theme, headingColor: "#166534" })?.theme.headingColor).toBeUndefined();
  });

  it("描述里带颜色名和版式", () => {
    const text = describeTheme(theme);
    expect(text).toContain("稳重深绿");
    expect(text).toContain("深绿");
    expect(text).toContain("两栏");
    expect(text).toContain("标题宋体");
  });
});

describe("样式偏好里的主题", () => {
  it("读出时校验主题，坏主题丢掉、只留预设", () => {
    expect(resolveResumeStyle({ template: "modern", accent: "teal", theme })).toEqual({
      template: "modern",
      accent: "teal",
      theme,
    });
    expect(
      resolveResumeStyle({ template: "modern", accent: "teal", theme: { ...theme, accent: "red" } }),
    ).toEqual({ template: "modern", accent: "teal" });
  });

  it("没有主题时从预设推出起点", () => {
    const start = themeFromPreset(DEFAULT_RESUME_STYLE);
    expect(start).toMatchObject({
      name: "经典校园",
      accent: "#2563eb",
      headerAlign: "center",
      layout: "single",
    });
    expect(themeFromPreset({ template: "minimal", accent: "wine" }).accent).toBe("#111111");
  });

  it("最接近的预设：两栏 → tech，色块抬头 → modern，强调色按色相取最近", () => {
    expect(fallbackPreset(theme)).toEqual({ template: "tech", accent: "teal" });
    expect(fallbackPreset({ ...theme, layout: "single", header: "band", accent: "#7f1d1d" })).toEqual({
      template: "modern",
      accent: "wine",
    });
    expect(fallbackPreset({ ...theme, layout: "single", accent: "#1f2937" })).toEqual({
      template: "minimal",
      accent: "ink",
    });
  });

  it("增量修改只改给出的字段，并同步写回最接近的预设", () => {
    const first = applyThemePatch(DEFAULT_RESUME_STYLE, { accent: "#166534", layout: "sidebar" });
    expect(first?.style.theme).toMatchObject({
      name: "我的定制",
      accent: "#166534",
      layout: "sidebar",
      headerAlign: "center",
    });
    expect(first?.style).toMatchObject({ template: "tech", accent: "teal" });
    const second = applyThemePatch(first?.style ?? DEFAULT_RESUME_STYLE, { density: "compact" });
    expect(second?.style.theme).toMatchObject({ accent: "#166534", layout: "sidebar", density: "compact" });
  });

  it("增量修改合并后不合法返回 null", () => {
    expect(applyThemePatch(DEFAULT_RESUME_STYLE, { accent: "nope" } as never)).toBeNull();
  });
});

describe("styleFromDesign", () => {
  it("整套主题成样式，不继承别处的骨架；颜色太浅自动加深", () => {
    const r = styleFromDesign({ ...theme, accent: "#aaccee", skeleton: "timeline" });
    expect(r.ok && r.style.theme?.skeleton).toBe("timeline");
    expect(r.ok && r.notes.length).toBeGreaterThan(0);
    const plain = styleFromDesign(theme);
    expect(plain.ok && plain.style.theme?.skeleton).toBeUndefined();
  });

  it("主题不合法或 CSS 含试探写法：拒绝", () => {
    expect(styleFromDesign({ name: "x" }).ok).toBe(false);
    expect(styleFromDesign(theme, "@import url(http://evil.example.com/a.css);").ok).toBe(false);
  });

  it("带合法 CSS：保存 CSS", () => {
    const r = styleFromDesign(
      theme,
      ".head::after { content: ''; display: block; height: 2pt; background: var(--accent) }",
    );
    expect(r.ok && r.style.css).toContain("--accent");
  });
});
