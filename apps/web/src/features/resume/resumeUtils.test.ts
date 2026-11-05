import { describe, expect, it } from "vitest";
import type { Completeness, QualityGap } from "../../api/types.ts";
import { isResumeComplete, matchesLabel, missingText } from "./resumeUtils.ts";

const gap = (key: string, label: string): QualityGap => ({ key, label, prompt: `帮我补${label}` });

const completeness = (gaps: QualityGap[], score = 0.5): Completeness => ({
  score,
  progress: 1,
  sections: [],
  missing: [],
  gaps,
  tips: [],
});

describe("missingText", () => {
  it("没有数据或没有短板不提示", () => {
    expect(missingText(undefined)).toBe("");
    expect(missingText(completeness([]))).toBe("");
  });

  it("列出简历短板，用户跳过的也照样算缺", () => {
    const text = missingText(
      completeness([gap("evidence", "能证明动手能力的经历"), gap("skills", "至少 3 项技能")]),
    );
    expect(text).toBe("还缺能证明动手能力的经历、至少 3 项技能");
  });

  it("超过 3 项时截断并加「等」", () => {
    const many = ["a", "b", "c", "d"].map((k) => gap(k, `项${k}`));
    expect(missingText(completeness(many))).toBe("还缺项a、项b、项c等");
  });
});

describe("isResumeComplete", () => {
  it("没有短板且充实度够高才算完成，问完了不算", () => {
    expect(isResumeComplete(undefined)).toBe(false);
    expect(isResumeComplete(completeness([gap("evidence", "经历")], 0.95))).toBe(false);
    expect(isResumeComplete(completeness([], 0.6))).toBe(false);
    expect(isResumeComplete(completeness([], 0.9))).toBe(true);
  });
});

describe("matchesLabel", () => {
  it("拿不到数量时不显示数字", () => {
    expect(matchesLabel(undefined)).toBe("看看推荐岗位");
    expect(matchesLabel(0)).toBe("看看推荐岗位");
    expect(matchesLabel(12)).toBe("看看推荐岗位（12 个匹配）");
  });
});
