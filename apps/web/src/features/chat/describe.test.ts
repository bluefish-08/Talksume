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

describe("简历要点展示", () => {
  it("要点显示中文名和新增的那条标题", () => {
    const text = describeChange({
      section: "projects",
      itemId: "p1",
      field: "highlights",
      previous: [{ title: "成绩统计", detail: "实现按班级统计成绩" }],
      value: [
        { title: "成绩统计", detail: "实现按班级统计成绩" },
        { title: "导入前数据校验", detail: "针对 Excel 格式混乱，导入前标出错误行" },
      ],
    });
    expect(text).toBe("要点：导入前数据校验");
  });

  it("没有标题时退回显示细节", () => {
    expect(formatValue({ detail: "导入前标出错误行" })).toBe("导入前标出错误行");
  });
});
