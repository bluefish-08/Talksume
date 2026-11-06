import { describe, expect, it } from "vitest";
import { DESIGN_DIRECTIONS, directionById, styleFromDirection } from "./resume-directions.ts";
import { THEME_SKELETONS } from "./resume-theme.ts";

describe("设计方向库", () => {
  it("数量足够、id 唯一、每个骨架都有方向", () => {
    expect(DESIGN_DIRECTIONS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(DESIGN_DIRECTIONS.map((d) => d.id)).size).toBe(DESIGN_DIRECTIONS.length);
    for (const s of THEME_SKELETONS) expect(DESIGN_DIRECTIONS.some((d) => d.skeleton === s)).toBe(true);
  });

  it("每个方向的每组配色都能成样式，CSS 一条都不被丢弃", () => {
    for (const d of DESIGN_DIRECTIONS) {
      expect(d.palettes.length).toBeGreaterThanOrEqual(2);
      d.palettes.forEach((_, palette) => {
        const r = styleFromDirection(d, { palette });
        expect(r.ok, `${d.id}#${palette}`).toBe(true);
        if (r.ok) {
          expect(
            r.notes.filter((n) => n.includes("丢弃")),
            `${d.id}#${palette}`,
          ).toEqual([]);
          expect(r.style.theme?.skeleton).toBe(d.skeleton);
        }
      });
    }
  });

  it("主色可以改写，名字可以改写", () => {
    const d = directionById("classic-bar-title");
    if (!d) throw new Error("缺方向");
    const r = styleFromDirection(d, { accent: "#0f766e", name: "我的蓝绿" });
    expect(r.ok && r.style.theme).toMatchObject({ accent: "#0f766e", name: "我的蓝绿" });
  });

  it("每个方向都写了设计手法和风格词", () => {
    for (const d of DESIGN_DIRECTIONS) {
      expect(d.craft.length, d.id).toBeGreaterThan(20);
      expect(d.words.length, d.id).toBeGreaterThanOrEqual(3);
    }
  });
});
