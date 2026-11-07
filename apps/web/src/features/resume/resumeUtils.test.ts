import { describe, expect, it } from "vitest";
import type { Completeness, QualityGap } from "../../api/types.ts";
import type { FactItem } from "./queries.ts";
import { editQuoteDraft, factQuotes, isResumeComplete, matchesLabel, missingText } from "./resumeUtils.ts";

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

describe("原话浮层", () => {
  const fact = (overrides: Partial<FactItem>): FactItem => ({
    id: "f1",
    section: "skills",
    quote: "我会 Go",
    sourceMessageId: "m1",
    status: "confirmed",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  });

  it("带轮次和待确认标记", () => {
    const quotes = factQuotes([fact({ status: "pending" })], () => 2);
    expect(quotes.f1).toEqual({ quote: "我会 Go", round: 2, pending: true });
  });

  it("导入简历来源不带轮次", () => {
    const quotes = factQuotes([fact({ source: "resume" })]);
    expect(quotes.f1).toEqual({ quote: "我会 Go", fromResume: true });
  });

  it("改这条只取原话前 12 个字", () => {
    expect(editQuoteDraft("一二三四五六七八九十十一十二")).toBe("「一二三四五六七八九十十一…」这条要改：");
    expect(editQuoteDraft("短话")).toBe("「短话」这条要改：");
  });
});
