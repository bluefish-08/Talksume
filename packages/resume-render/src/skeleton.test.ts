import { type ResumeTheme, THEME_SKELETONS } from "@talksume/core";
import { afterAll, describe, expect, it } from "vitest";
import { renderFragment, renderPdf, renderResumePng, sampleResume } from "./index.ts";

afterAll(async () => (await import("./index.ts")).close());

const theme = (skeleton: ResumeTheme["skeleton"]): ResumeTheme => ({
  name: "测试",
  accent: "#1f4e79",
  bodyFont: "sans",
  headingFont: "sans",
  header: "plain",
  headerAlign: "left",
  headingStyle: "bar",
  layout: "single",
  bullet: "dot",
  skills: "line",
  density: "auto",
  skeleton,
});

const ids = (html: string, attr: string) =>
  [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, "g"))].map((m) => m[1]);

describe("页面骨架", () => {
  const classic = renderFragment(sampleResume, { theme: theme("classic") });

  for (const name of THEME_SKELETONS) {
    it(`${name}：分区/条目序号齐全，抬头先于正文`, () => {
      const f = renderFragment(sampleResume, { theme: theme(name) });
      expect(ids(f.html, "data-section").sort()).toEqual(ids(classic.html, "data-section").sort());
      expect(ids(f.html, "data-item").sort()).toEqual(ids(classic.html, "data-item").sort());
      expect(ids(f.html, "data-bullet").sort()).toEqual(ids(classic.html, "data-bullet").sort());
      const nameAt = f.html.indexOf(`<h1>${sampleResume.basics.name}</h1>`);
      const firstSection = f.html.indexOf("<section");
      expect(nameAt).toBeGreaterThan(-1);
      expect(nameAt).toBeLessThan(firstSection);
      expect(f.html).not.toContain("<script");
    });
  }

  it("同一个分区只出现一次，不重复也不丢", () => {
    for (const name of THEME_SKELETONS) {
      const f = renderFragment(sampleResume, { theme: theme(name) });
      const secs = ids(f.html, "data-section");
      expect(new Set(secs).size).toBe(secs.length);
    }
  });

  for (const name of THEME_SKELETONS) {
    it(`${name}：渲染成一页，文字和经典骨架逐字一致`, async () => {
      const base = await renderResumePng(sampleResume, { theme: theme("classic") });
      const out = await renderResumePng(sampleResume, { theme: theme(name) });
      expect(out.check.pages).toBe(1);
      expect(out.check.hiddenText).toBe(0);
      expect(out.check.overflowX).toBe(0);
      expect(out.check.lowContrast).toBe(0);
      expect(out.check.covered).toBe(0);
      const sorted = (t: string) => [...t.replace(/\s/g, "")].sort().join("");
      expect(sorted(out.check.text)).toBe(sorted(base.check.text));
    });
  }

  it("通栏侧栏的 DOM 里姓名在前、侧栏分区先于正文分区（ATS 读出的顺序）", () => {
    const f = renderFragment(sampleResume, { theme: theme("side-left") });
    expect(f.html.indexOf('data-kind="education"')).toBeLessThan(f.html.indexOf('data-kind="experiences"'));
  });

  it("满铺骨架页边距为 0，其余沿用档位边距", () => {
    expect(renderFragment(sampleResume, { theme: theme("side-left") }).margin).toBe("0mm 0mm");
    expect(renderFragment(sampleResume, { theme: theme("cards") }).margin).toBe("0mm 0mm");
    expect(renderFragment(sampleResume, { theme: theme("timeline") }).margin).not.toBe("0mm 0mm");
  });

  for (const name of THEME_SKELETONS) {
    it(`${name}：PDF 同样是一页`, async () => {
      const pdf = await renderPdf(sampleResume, { theme: theme(name) });
      expect(new TextDecoder().decode(pdf).match(/\/Type\s*\/Page[^s]/g)?.length ?? 0).toBe(1);
    });
  }
});
