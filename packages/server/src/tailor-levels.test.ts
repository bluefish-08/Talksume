import { describe, expect, it } from "vitest";
import { charOverlap, levelViolations, tagAllowed } from "./tailor-levels.ts";

const ORIGINAL = "用 MySQL 存订单数据，写了查询接口";

describe("定制档位校验", () => {
  it("微调：不能出现原文没有的技能名，哪怕是上位说法", () => {
    expect(levelViolations("light", ORIGINAL, "用 MySQL 数据库存订单数据，写了查询接口")).toContain(
      "新增技能「数据库」",
    );
  });

  it("嵌入关键词：原文有 MySQL，可以改用「数据库」的说法", () => {
    expect(levelViolations("keywords", ORIGINAL, "用 MySQL 数据库存订单数据，写了查询接口")).toEqual([]);
  });

  it("原文没有的技能三档都拦", () => {
    for (const level of ["light", "keywords", "deep"] as const) {
      expect(levelViolations(level, ORIGINAL, "用 MySQL 存订单数据，并用 Kafka 异步写入")).toContain(
        "新增技能「Kafka」",
      );
    }
  });

  it("微调要求措辞基本沿用原文，深度改写不限", () => {
    const rewritten = "独立设计订单存储方案并实现对外查询服务";
    expect(charOverlap(ORIGINAL, rewritten)).toBeLessThan(0.8);
    expect(levelViolations("light", ORIGINAL, rewritten)).toContain("措辞改动超出本档范围");
    expect(levelViolations("deep", ORIGINAL, rewritten)).toEqual([]);
  });

  it("JD 标签「数据库」：嵌入关键词档因原文有 MySQL 放行，微调档和原文没有的标签不放行", () => {
    expect(tagAllowed("keywords", ORIGINAL, "数据库")).toBe(true);
    expect(tagAllowed("light", ORIGINAL, "数据库")).toBe(false);
    expect(tagAllowed("keywords", ORIGINAL, "Kafka")).toBe(false);
  });

  it("字符重合度：原文的重排接近 1", () => {
    expect(charOverlap("负责订单查询接口开发", "订单查询接口开发，负责")).toBe(1);
  });
});
