import { describe, expect, it } from "vitest";
import { applyHardFilters, highestDegree, requiredDegree } from "./filters.ts";
import { makeJob, makeProfile } from "./fixtures.ts";

describe("硬性过滤", () => {
  const profile = makeProfile({ intention: { roles: ["后端"], cities: ["上海"], jobType: "internship" } });

  it("求职类型不符被剔除，岗位没标类型则放行", () => {
    expect(applyHardFilters(profile, makeJob({ title: "a", jobType: "campus" }))).toMatchObject({
      pass: false,
      reason: "jobType",
    });
    expect(applyHardFilters(profile, makeJob({ title: "a", jobType: "internship" })).pass).toBe(true);
    expect(applyHardFilters(profile, makeJob({ title: "a" })).pass).toBe(true);
  });

  it("城市不在意向内被剔除；不限、远程、岗位无城市放行", () => {
    expect(applyHardFilters(profile, makeJob({ title: "a", cities: ["北京"] }))).toMatchObject({
      pass: false,
      reason: "city",
    });
    expect(applyHardFilters(profile, makeJob({ title: "a", cities: ["北京", "上海"] })).pass).toBe(true);
    expect(applyHardFilters(profile, makeJob({ title: "a", cities: ["远程"] })).pass).toBe(true);
    expect(applyHardFilters(profile, makeJob({ title: "a", cities: [] })).pass).toBe(true);
    const anywhere = makeProfile({ intention: { roles: [], cities: ["不限"] } });
    expect(applyHardFilters(anywhere, makeJob({ title: "a", cities: ["北京"] })).pass).toBe(true);
    const none = makeProfile({ intention: { roles: [], cities: [] } });
    expect(applyHardFilters(none, makeJob({ title: "a", cities: ["北京"] })).pass).toBe(true);
  });

  it("strictCity 关闭后不再按城市剔除", () => {
    expect(
      applyHardFilters(profile, makeJob({ title: "a", cities: ["北京"] }), { strictCity: false }).pass,
    ).toBe(true);
  });

  it("学历低于岗位要求被剔除", () => {
    const job = makeJob({ title: "a", degree: "master" });
    expect(applyHardFilters(profile, job)).toMatchObject({ pass: false, reason: "degree" });
    const master = makeProfile({
      education: [
        { id: "e1", school: "A", degree: "bachelor" },
        { id: "e2", school: "B", degree: "master" },
      ],
    });
    expect(highestDegree(master)).toBe("master");
    expect(applyHardFilters(master, job).pass).toBe(true);
  });

  it("岗位学历字段缺失时从 JD 推断，「优先」不算硬要求", () => {
    expect(requiredDegree(makeJob({ title: "a", jdText: "硕士及以上学历，专业不限" }))?.degree).toBe(
      "master",
    );
    expect(requiredDegree(makeJob({ title: "a", jdText: "本科及以上；硕士及以上优先" }))?.degree).toBe(
      "bachelor",
    );
    expect(requiredDegree(makeJob({ title: "a", jdText: "博士在读优先考虑" }))).toBeUndefined();
    expect(requiredDegree(makeJob({ title: "a", degree: "any", jdText: "硕士及以上" }))).toBeUndefined();
    const bachelor = makeProfile();
    expect(applyHardFilters(bachelor, makeJob({ title: "a", jdText: "硕士在读" })).pass).toBe(false);
  });

  it("岗位已关闭被剔除", () => {
    expect(applyHardFilters(profile, makeJob({ title: "a" }), { status: "closed" }).reason).toBe("closed");
  });
});
