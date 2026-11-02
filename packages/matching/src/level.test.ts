import { describe, expect, it } from "vitest";
import { makeJob, makeProfile } from "./fixtures.ts";
import { experienceYears, levelAdjustment, requiredYears } from "./level.ts";

const NOW = new Date("2026-06-15");
const intern = {
  id: "x",
  kind: "internship" as const,
  company: "A",
  title: "后端实习",
  start: "2025-07",
  end: "2025-12",
};

describe("资深度", () => {
  it("从 JD 年限或资深头衔识别要求，忽略年份与 1 年以内", () => {
    expect(requiredYears({ title: "后端", jdText: "3年以上游戏服务端开发经验" })?.years).toBe(3);
    expect(requiredYears({ title: "高级后端", jdText: "负责服务端" })?.years).toBe(3);
    expect(requiredYears({ title: "后端", jdText: "2026年毕业，有实习经验优先" })).toBeUndefined();
    expect(requiredYears({ title: "后端", jdText: "1年以上相关经验" })).toBeUndefined();
  });

  it("实习折半计入年限，全职按整年", () => {
    const full = { ...intern, kind: "fulltime" as const, start: "2024-01", end: "2025-12" };
    expect(experienceYears(makeProfile({ experiences: [intern] }), NOW)).toBeCloseTo(0.25, 5);
    expect(experienceYears(makeProfile({ experiences: [full] }), NOW)).toBeCloseTo(2, 5);
  });

  it("经验远不及要求时降分并给出说明，足够时不处理", () => {
    const job = makeJob({ title: "高级服务端开发", jdText: "3年以上服务端开发经验" });
    const fresh = levelAdjustment(makeProfile({ experiences: [intern] }), job, NOW);
    expect(fresh.multiplier).toBe(0.6);
    expect(fresh.evidence).toContain("3年以上");
    const mid = { ...intern, kind: "fulltime" as const, start: "2024-12", end: "2025-12" };
    expect(levelAdjustment(makeProfile({ experiences: [mid] }), job, NOW).multiplier).toBe(0.8);
    const senior = { ...mid, start: "2022-01" };
    expect(levelAdjustment(makeProfile({ experiences: [senior] }), job, NOW)).toEqual({ multiplier: 1 });
  });
});
