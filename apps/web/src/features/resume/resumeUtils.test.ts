import { describe, expect, it } from "vitest";
import type { Completeness, MissingField, ProfileSection } from "../../api/types.ts";
import { missingText } from "./resumeUtils.ts";

const miss = (
  section: ProfileSection,
  field: string,
  label: string,
  extra: Partial<MissingField> = {},
): MissingField => ({
  key: `${section}:_:${field}`,
  section,
  field,
  label,
  weight: 1,
  required: true,
  kind: "field",
  ...extra,
});

const completeness = (missing: MissingField[], completed: ProfileSection[] = []): Completeness => ({
  score: 0.74,
  sections: (["basics", "education", "experiences", "projects"] as const).map((section) => ({
    section,
    weight: 1,
    score: missing.some((m) => m.section === section) ? 0.8 : 1,
    completed: completed.includes(section),
  })),
  missing,
});

describe("missingText", () => {
  it("没有数据或都齐了不提示", () => {
    expect(missingText(undefined)).toBe("");
    expect(missingText(completeness([]))).toBe("");
  });

  it("部分缺失的板块说具体缺什么，不再笼统列出板块", () => {
    const text = missingText(
      completeness([
        miss("basics", "email", "邮箱"),
        miss("projects", "_item", "新增项目经历", { kind: "new_item" }),
      ]),
    );
    expect(text).toBe("还差邮箱、项目经历");
    expect(text).not.toContain("教育");
  });

  it("列表型分区的字段带上分区名，同名只列一次", () => {
    const text = missingText(
      completeness([
        miss("education", "major", "专业", { itemId: "a" }),
        miss("education", "major", "专业", { itemId: "b" }),
      ]),
    );
    expect(text).toBe("还差教育经历的专业");
  });

  it("同一分区的多个字段合并，并去掉括号注释", () => {
    const text = missingText(
      completeness([
        miss("projects", "role", "担任角色"),
        miss("projects", "action", "行动（A）"),
        miss("projects", "result", "结果（R）"),
      ]),
    );
    expect(text).toBe("还差项目经历的担任角色、行动、结果");
  });

  it("忽略选填项、量化提示和已标记完成的分区", () => {
    const text = missingText(
      completeness(
        [
          miss("basics", "city", "所在城市", { required: false }),
          miss("projects", "result_quantified", "结果的量化数据", { kind: "quantify" }),
          miss("experiences", "bullets", "工作内容与成果"),
        ],
        ["experiences"],
      ),
    );
    expect(text).toBe("");
  });

  it("超过 4 项时截断并加「等」", () => {
    const many = ["a", "b", "c", "d", "e"].map((f) => miss("basics", f, `项${f}`));
    expect(missingText(completeness(many))).toBe("还差项a、项b、项c、项d等");
  });
});
