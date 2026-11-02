import { describe, expect, it } from "vitest";
import { findSkills, normalizeSkill, normalizeSkillList } from "./synonyms.ts";

describe("技能同义词归一", () => {
  it.each([
    ["JS", "JavaScript"],
    ["javascript", "JavaScript"],
    ["Golang", "Go"],
    ["go语言", "Go"],
    ["ML", "机器学习"],
    ["Machine Learning", "机器学习"],
    ["k8s", "Kubernetes"],
    ["springboot", "Spring"],
    ["PS", "Photoshop"],
  ])("%s -> %s", (raw, canon) => {
    expect(normalizeSkill(raw)).toBe(canon);
  });

  it("词典外的技能退化为小写去空白", () => {
    expect(normalizeSkill("  Some  Tool ")).toBe("some tool");
  });

  it("复合写法拆成多个技能", () => {
    expect(normalizeSkillList("Python/Go")).toEqual(expect.arrayContaining(["Python", "Go"]));
  });
});

describe("在文本里找技能", () => {
  const names = (t: string) => findSkills(t).map((h) => h.name);

  it("C/C++/Java/Go 同时识别", () => {
    expect(names("熟练掌握C/C++/Java/Go等其中一门开发语言")).toEqual(
      expect.arrayContaining(["C", "C++", "Java", "Go"]),
    );
  });

  it("不把普通单词和相近词误判", () => {
    expect(names("a good engineer with JavaScript")).toEqual(["JavaScript"]);
    expect(names("负责C端产品增长")).not.toContain("C");
    expect(names("熟悉 Java 开发")).not.toContain("JavaScript");
  });

  it("大小写不敏感的别名与带符号的名字", () => {
    expect(names("会用 pytorch 和 C#")).toEqual(expect.arrayContaining(["PyTorch", "C#"]));
  });
});
