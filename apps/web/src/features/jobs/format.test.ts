import { describe, expect, it } from "vitest";
import {
  applyFilter,
  buildChips,
  citiesText,
  dimRows,
  evidenceLines,
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
    reportStatus: "none",
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

  it("appends the semantic row only when the match was reranked", () => {
    const semantic = { score: 0.82, weight: 0.2, evidence: ["语义模型判断岗位内容与你的意向和经历高度相关"] };
    const rows = dimRows(match({ dims: { semantic } }));
    expect(rows.at(-1)).toEqual({ key: "semantic", label: "语义相关", score: 0.82, applicable: true });
    expect(dimRows(match()).some((r) => r.key === "semantic")).toBe(false);
  });

  it("picks the reason line from report then evidence", () => {
    expect(reasonLine(match({ report: { strengths: ["对口"] } }))).toBe("对口");
    const m = match({ dims: { role: { score: 1, weight: 0.25, evidence: ["岗位同属后端"] } } });
    expect(reasonLine(m)).toBe("岗位同属后端");
  });

  it("puts skill and experience evidence ahead of major and city", () => {
    const dim = (score: number, weight: number, text: string) => ({ score, weight, evidence: [text] });
    const m = match({
      dims: {
        major: dim(1, 0.1, "画像专业符合 JD"),
        city: dim(1, 0.1, "城市在意向内"),
        skills: dim(0.7, 0.3, "命中 Go：美团实习"),
        experience: dim(0.8, 0.25, "实习与岗位同属后端"),
      },
    });
    expect(evidenceLines(m)).toEqual(["命中 Go：美团实习", "实习与岗位同属后端"]);
    expect(reasonLine(m)).toBe("命中 Go：美团实习");
    const onlyMajor = match({ dims: { major: dim(1, 0.1, "画像专业符合 JD") } });
    expect(evidenceLines(onlyMajor)).toEqual(["画像专业符合 JD"]);
  });

  it("polls only while the server reports pending reports among the top items", () => {
    const ready = Array.from({ length: 10 }, () =>
      match({ report: { summary: "ok" }, reportStatus: "ready" }),
    );
    const pending = match({ reportStatus: "pending" });
    expect(reportsPending([...ready, pending])).toBe(false);
    expect(reportsPending([pending, ...ready])).toBe(true);
    expect(reportsPending([match({ reportStatus: "failed" }), ...ready])).toBe(false);
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
