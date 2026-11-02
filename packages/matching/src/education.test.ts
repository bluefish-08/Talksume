import { describe, expect, it } from "vitest";
import { educationByRecency, primaryEducation } from "./education.ts";
import { makeProfile } from "./fixtures.ts";

const edu = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  school: id,
  degree: "bachelor",
  ...over,
});

describe("教育经历排序", () => {
  it("学历优先，其次毕业时间，再次后加入的在前", () => {
    const profile = makeProfile({
      education: [
        edu("专科", { degree: "associate", end: "2030-06" }),
        edu("本科早", { end: "2022-06" }),
        edu("硕士", { degree: "master", end: "2020-06" }),
        edu("本科晚", { end: "2024-06" }),
        edu("本科无时间"),
      ],
    });
    expect(educationByRecency(profile).map((e) => e.school)).toEqual([
      "硕士",
      "本科晚",
      "本科早",
      "本科无时间",
      "专科",
    ]);
    expect(primaryEducation(profile)?.school).toBe("硕士");
  });

  it("在读（present）视为最晚，不修改原数组", () => {
    const profile = makeProfile({
      education: [edu("a", { end: "2025-06" }), edu("b", { start: "2025-09", end: "present" })],
    });
    expect(primaryEducation(profile)?.school).toBe("b");
    expect(profile.education.map((e) => e.school)).toEqual(["a", "b"]);
  });

  it("没有教育经历时返回 undefined", () => {
    expect(primaryEducation({ education: [] })).toBeUndefined();
  });
});
