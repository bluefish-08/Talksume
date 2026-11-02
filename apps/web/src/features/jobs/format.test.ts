import { describe, expect, it } from "vitest";
import {
  applyFilter,
  buildChips,
  citiesText,
  dimRows,
  formatSalary,
  reasonLine,
  reportsPending,
  sourceLabel,
  totalOpenJobs,
} from "./format.ts";
import type { MatchItem } from "./types.ts";

function match(
  over: Partial<MatchItem> & { cities?: string[]; jobType?: "internship" | "campus" } = {},
): MatchItem {
  const { cities = ["上海"], jobType = "internship", ...rest } = over;
  return {
    jobId: "j",
    score: 80,
    dims: {},
    report: {},
    feedback: null,
    createdAt: "",
    job: { id: "j", source: "x", company: "c", title: "t", cities, jobType, tags: [], snippet: "" },
    ...rest,
  };
}

describe("jobs format", () => {
  it("maps source labels with fallback", () => {
    expect(sourceLabel("tencent_campus")).toBe("腾讯招聘官网");
    expect(sourceLabel("unknown_src")).toBe("unknown_src");
  });

  it("truncates long city lists", () => {
    expect(citiesText(["上海", "深圳", "北京"], 2)).toBe("上海 / 深圳 等 3 城");
    expect(citiesText(["上海"])).toBe("上海");
    expect(citiesText([])).toBeUndefined();
  });

  it("formats salary", () => {
    expect(formatSalary({ salaryMin: 15000, salaryMax: 25000 })).toBe("15-25K/月");
    expect(formatSalary({})).toBeUndefined();
  });

  it("treats weight 0 as not applicable", () => {
    const rows = dimRows(
      match({
        dims: {
          city: { score: 1, weight: 0, evidence: [] },
          skills: { score: 0.5, weight: 0.3, evidence: [] },
        },
      }),
    );
    expect(rows.map((r) => r.key)).toEqual(["skills", "role", "experience", "major", "city"]);
    expect(rows.find((r) => r.key === "city")?.applicable).toBe(false);
    expect(rows.find((r) => r.key === "skills")?.applicable).toBe(true);
  });

  it("picks the reason line from report then evidence", () => {
    expect(reasonLine(match({ report: { strengths: ["对口"] } }))).toBe("对口");
    const m = match({ dims: { role: { score: 1, weight: 0.25, evidence: ["岗位同属后端"] } } });
    expect(reasonLine(m)).toBe("岗位同属后端");
  });

  it("detects pending reports among the top items only", () => {
    const filled = Array.from({ length: 10 }, () => match({ report: { summary: "ok" } }));
    expect(reportsPending([...filled, match()])).toBe(false);
    expect(reportsPending([match(), ...filled])).toBe(true);
  });

  it("builds and applies chips", () => {
    const items = [
      match({ cities: ["上海", "深圳"] }),
      match({ cities: ["上海"], jobType: "campus" }),
      match({ cities: ["北京"] }),
    ];
    const chips = buildChips(items);
    expect(chips[0]).toEqual({ key: "all", label: "全部", count: 3 });
    expect(chips.find((c) => c.key === "city:上海")?.count).toBe(2);
    expect(applyFilter(items, "city:上海")).toHaveLength(2);
    expect(applyFilter(items, "type:campus")).toHaveLength(1);
    expect(applyFilter(items, "all")).toHaveLength(3);
  });

  it("sums open jobs without closed ones", () => {
    expect(
      totalOpenJobs({
        count: 49,
        candidates: 49,
        excluded: { jobType: 97, city: 53, degree: 1, closed: 9 },
        rerank: "pending",
      }),
    ).toBe(200);
  });
});
