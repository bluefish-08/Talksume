import { describe, expect, it } from "vitest";
import { describeChange, formatValue } from "./describe.ts";

describe("技能熟练度展示", () => {
  it("四档各自对应原话，熟悉不再显示成了解", () => {
    expect(["beginner", "familiar", "proficient", "expert"].map(formatValue)).toEqual([
      "了解",
      "熟悉",
      "熟练",
      "精通",
    ]);
  });

  it("新增技能条目保留熟悉", () => {
    const text = describeChange({
      section: "skills",
      field: "_item",
      value: { name: "Go", level: "familiar" },
    });
    expect(text).toBe("Go · 熟悉");
  });
});

describe("校园经历归类", () => {
  it("项目的 kind=campus 不显示成校招", () => {
    expect(describeChange({ section: "projects", itemId: "p1", field: "kind", value: "campus" })).toBe(
      "归入校园经历",
    );
  });
});
