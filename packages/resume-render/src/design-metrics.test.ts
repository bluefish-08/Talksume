import { DESIGN_DIRECTIONS, RESUME_TEMPLATES, styleFromDirection } from "@talksume/core";
import { afterAll, describe, expect, it } from "vitest";
import { close, designScore, sampleResume } from "./index.ts";

afterAll(close);

describe("设计标准量化", () => {
  it("预设模板都过得去，层级和对比不低于 3", async () => {
    for (const template of RESUME_TEMPLATES) {
      const s = await designScore(sampleResume, { template, accent: "blue" });
      expect(s.hierarchy, template).toBeGreaterThanOrEqual(3);
      expect(s.contrast, template).toBe(5);
      expect(s.overall, template).toBeGreaterThanOrEqual(3);
    }
  });

  it("所有字一样大、挤在页面左边缘的版式分数明显更低", async () => {
    const good = await designScore(sampleResume, { template: "modern", accent: "blue" });
    const bad = await designScore(sampleResume, {
      template: "campus",
      accent: "blue",
      css: ".head h1 { font-size: 7pt } h2 { font-size: 7pt; font-weight: 400 } .resume { padding: 0 }",
    });
    expect(bad.overall).toBeLessThan(good.overall);
  });

  it("设计方向库的第一组配色整体不低于 3.5", async () => {
    const scores: number[] = [];
    for (const d of DESIGN_DIRECTIONS) {
      const built = styleFromDirection(d);
      if (!built.ok) throw new Error(built.errors.join());
      scores.push((await designScore(sampleResume, built.style)).overall);
    }
    expect(scores.reduce((a, b) => a + b, 0) / scores.length).toBeGreaterThanOrEqual(3.5);
  }, 120_000);
});
