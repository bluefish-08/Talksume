import { Profile } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { applyFacts } from "./facts.ts";
import type { FactInput } from "./schemas.ts";
import { resumeWording, tidyWording, wordingProblems } from "./wording.ts";

const QUOTE =
  "大二下学期 Java 课的课程设计，学生成绩管理系统，我负责成绩录入和查询，界面用 Swing，数据存 MySQL，写了增删改查。";

describe("resume wording", () => {
  it("accepts a resume-style rewrite that adds no facts", () => {
    const text = "负责成绩录入与查询模块，基于 Swing 实现界面，使用 MySQL 完成数据的增删改查";
    expect(wordingProblems(text, QUOTE)).toEqual([]);
  });

  it("accepts a rewrite that rephrases connecting words", () => {
    const source = "我负责搭用户流失预警看板，每周给运营出一份流失名单";
    expect(wordingProblems("负责搭建用户流失预警看板，每周向运营输出流失名单", source)).toEqual([]);
  });

  it.each([
    ["独立负责成绩录入与查询模块", "独立"],
    ["担任项目负责人，完成成绩录入与查询", "负责人"],
    ["负责成绩录入与查询，查询效率提升 30%", "30"],
    ["负责成绩录入与查询，基于 Spring Boot 实现后端", "Spring"],
    ["负责成绩录入与查询，并实现权限管理和成绩统计报表导出", "原话之外的内容"],
  ])("flags %s", (text, problem) => {
    expect(wordingProblems(text, QUOTE)).toContain(problem);
  });

  it("does not let 参与 become 负责", () => {
    expect(wordingProblems("负责组织电脑义诊", "参与组织过一次电脑义诊")).toContain("负责");
  });

  it("falls back to the user's words without the leading 我", () => {
    const worded = resumeWording("主导成绩录入模块的设计", QUOTE, QUOTE);
    expect(worded.problems).toContain("主导");
    expect(worded.text).toBe(
      "Java 课的课程设计，学生成绩管理系统，负责成绩录入和查询，界面用 Swing，数据存 MySQL，写了增删改查",
    );
  });

  it("strips a clause-initial 我 but keeps 我们组", () => {
    expect(tidyWording("来的人排着队，我一个个登记名字，然后安排同学去弄")).toBe(
      "来的人排着队，一个个登记名字，然后安排同学去弄",
    );
  });

  it("accepts a synonym rewrite such as 清灰 → 清理电脑灰尘", () => {
    const source =
      "大一的时候在计算机协会，参与组织过一次电脑义诊，给同学免费清灰、重装系统，我负责现场登记和帮同学装系统";
    expect(wordingProblems("负责现场登记，并为同学重装系统、清理电脑灰尘", source)).toEqual([]);
  });

  it("only strips 我们 in front of an action", () => {
    expect(tidyWording("我负责登记，我们组负责装系统。")).toBe("负责登记，我们组负责装系统");
  });

  it("matches latin words against the punctuation-free user corpus", () => {
    expect(wordingProblems("基于 Spring Boot 开发接口", "用springboot写的接口")).toEqual([]);
  });
});

const fact = (payload: Record<string, unknown>, quote = QUOTE) =>
  ({ section: "projects", payload, quote }) as FactInput;

describe("applyFacts wording", () => {
  it("keeps a valid rewrite and reverts an inflated one to the quote", () => {
    const result = applyFacts(
      Profile.parse({}),
      [
        fact({
          name: "学生成绩管理系统",
          role: "项目负责人",
          highlights: [
            { title: "成绩录入与查询", detail: "我负责成绩录入与查询模块，基于 Swing 实现界面。" },
            { title: "主导架构设计", detail: "主导系统架构设计" },
          ],
        }),
      ],
      { messageId: "m1", userText: QUOTE },
    );
    const project = result.profile.projects[0];
    expect(project?.role).toBeUndefined();
    expect(project?.highlights?.[0]).toEqual({
      title: "成绩录入与查询",
      detail: "负责成绩录入与查询模块，基于 Swing 实现界面",
    });
    expect(project?.highlights?.[1]?.title).toBeUndefined();
    expect(project?.highlights?.[1]?.detail).toContain("负责成绩录入和查询");
    expect(result.reverted.map((r) => r.field)).toEqual(["highlights", "highlights", "role"]);
  });
});

describe("bare confirmations", () => {
  it("drops an unverifiable point instead of writing 做过 as its detail", () => {
    const result = applyFacts(
      Profile.parse({}),
      [fact({ name: "课程设计", highlights: [{ title: "权限模块", detail: "实现了权限管理模块" }] }, "做过")],
      { messageId: "m1", userText: "做过" },
    );
    expect(result.drafts[0]?.item.highlights ?? result.profile.projects[0]?.highlights ?? []).toEqual([]);
    expect(result.reverted[0]?.reason).toContain("已去掉");
  });
});

describe("negated and inferred facts", () => {
  const apply = (inputs: FactInput[], userText = "") =>
    applyFacts(Profile.parse({}), inputs, { messageId: "m1", userText });
  const q = "就学过 Java 和 MySQL，课上学的，谈不上熟练，Git 没用过。";

  it("refuses to record a skill the user said they never used", () => {
    const result = apply([
      { section: "skills", payload: { name: "Java" }, quote: q },
      { section: "skills", payload: { name: "Git" }, quote: q },
    ] as FactInput[]);
    expect(result.profile.skills.map((s) => s.name)).toEqual(["Java"]);
    expect(result.rejected[0]?.reason).toContain("Git");
  });

  it("keeps a skill named before an 除了…没学过别的 clause", () => {
    const result = apply([
      { section: "skills", payload: { name: "Java" }, quote: "除了 Java 没学过别的" },
    ] as FactInput[]);
    expect(result.profile.skills).toHaveLength(1);
  });

  it("drops a negated entry from a tech stack", () => {
    const result = apply([
      fact({ name: "学生成绩管理系统", techStack: ["Swing", "Git"] }, "界面用 Swing，Git 没用过"),
    ]);
    expect(result.profile.projects[0]?.techStack).toEqual(["Swing"]);
  });

  it("does not turn 大二下学期 into a year and month", () => {
    const result = apply([fact({ name: "学生成绩管理系统", start: "2024-09", end: "2025-01" })]);
    expect(result.profile.projects[0]?.start).toBeUndefined();
    expect(result.profile.projects[0]?.end).toBeUndefined();
    expect(result.dropped.map((d) => d.field)).toEqual(["start", "end"]);
  });

  it("keeps dates the user spelled out, and a year-only school start", () => {
    const project = apply([
      fact({ name: "排课助手", start: "2025-03", end: "2025-06" }, "2025年3月到6月做的排课助手"),
    ]);
    expect(project.profile.projects[0]).toMatchObject({ start: "2025-03", end: "2025-06" });
    const school = apply([
      {
        section: "education",
        payload: { school: "江城职业技术学院", degree: "associate", start: "2023-09" },
        quote: "江城职业技术学院，23年入学",
      },
    ] as FactInput[]);
    expect(school.profile.education[0]?.start).toBe("2023-09");
  });

  it("drops an award month, an arrival date and a city the user never said", () => {
    const result = apply(
      [
        {
          section: "awards",
          payload: { name: "校二等奖学金", date: "2024-01" },
          quote: "2024年拿过校二等奖学金",
        },
        { section: "intention", payload: { availableFrom: "2025-01" }, quote: "明年1月能到岗" },
        {
          section: "education",
          payload: { school: "青禾大学", degree: "bachelor", city: "武汉" },
          quote: "青禾大学本科",
        },
      ] as FactInput[],
      "2024年拿过校二等奖学金 明年1月能到岗 青禾大学本科",
    );
    expect(result.profile.awards[0]?.date).toBeUndefined();
    expect(result.profile.intention.availableFrom).toBeUndefined();
    expect(result.profile.education[0]?.city).toBeUndefined();
  });
});

describe("fallback cleanup", () => {
  it("strips the time and the organisation already in the heading", () => {
    expect(
      tidyWording("大一在计算机协会，参加过一次电脑义诊，负责现场登记和帮同学装系统。", "计算机协会电脑义诊"),
    ).toBe("参与电脑义诊，负责现场登记和帮同学装系统");
  });

  it("keeps a place that the heading does not carry", () => {
    expect(tidyWording("在图书馆帮老师整理书目", "勤工俭学")).toBe("在图书馆帮老师整理书目");
  });
});
