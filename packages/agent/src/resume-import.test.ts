import { Profile } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { createIdGenerator } from "./facts.ts";
import {
  applyImport,
  describeImportGroups,
  groupImportFacts,
  importOpening,
  verifyImportFacts,
} from "./resume-import.ts";
import { createIntakeState } from "./types.ts";

// 虚构样例
const TEXT = `李明
电话：139-0000-1234 | 邮箱：liming@example.com | 江城
江城大学 · 软件工程 · 本科 2023.09 – 2027.06
GPA 3.6/4.0
校园食堂点餐小程序 · 后端开发 2024.09 – 2025.01
技术栈：Spring Boot、MySQL、Redis
负责订单模块和支付回调接口的开发
使用 Redis 缓存菜单数据，高峰期接口响应从 600ms 降到 150ms
熟悉 Java、Spring Boot`;

const basics = {
  section: "basics",
  payload: { name: "李明", phone: "139-0000-1234", email: "liming@example.com", city: "江城" },
  quote: "李明 … 电话：139-0000-1234 | 邮箱：liming@example.com | 江城",
};
const education = {
  section: "education",
  payload: {
    school: "江城大学",
    degree: "bachelor",
    major: "软件工程",
    gpa: "3.6/4.0",
    start: "2023-09",
    end: "2027-06",
  },
  quote: "江城大学 · 软件工程 · 本科 2023.09 – 2027.06",
};
const project = {
  section: "projects",
  payload: {
    name: "校园食堂点餐小程序",
    role: "后端开发",
    techStack: ["Spring Boot", "MySQL", "Redis"],
    highlights: [
      { title: "订单模块", detail: "负责订单模块和支付回调接口的开发" },
      { title: "菜单缓存", detail: "使用 Redis 缓存菜单数据,高峰期接口响应从 600ms 降到 150ms" },
    ],
    start: "2024-09",
    end: "2025-01",
  },
  quote: "校园食堂点餐小程序 · 后端开发 2024.09 – 2025.01",
};
const skill = {
  section: "skills",
  payload: { name: "Java", level: "familiar" },
  quote: "熟悉 Java、Spring Boot",
};

describe("verifyImportFacts", () => {
  it("原文里找得到的事实全部保留，标点和空格差异不影响", () => {
    const { facts, dropped } = verifyImportFacts(TEXT, [basics, education, project, skill]);
    expect(dropped).toEqual([]);
    expect(facts).toHaveLength(4);
  });

  it("quote 在原文里找不到的整条丢弃", () => {
    const fake = {
      section: "experiences",
      payload: { company: "星河科技", kind: "internship", title: "后端实习生" },
      quote: "星河科技 后端开发实习生 2024.07 – 2024.09",
    };
    const { facts, dropped } = verifyImportFacts(TEXT, [fake, skill]);
    expect(facts.map((f) => f.section)).toEqual(["skills"]);
    expect(dropped).toEqual([expect.objectContaining({ section: "experiences", label: "星河科技" })]);
  });

  it("quote 真实但 payload 夹带的编造内容按字段丢弃", () => {
    const padded = {
      ...project,
      payload: {
        ...project.payload,
        techStack: ["Spring Boot", "Kafka"],
        highlights: [
          ...project.payload.highlights,
          { title: "高并发", detail: "支撑日均 10 万订单，QPS 提升 50%" },
        ],
      },
    };
    const wrongMajor = {
      ...education,
      payload: { ...education.payload, major: "人工智能", rank: "专业前 5%" },
    };
    const { facts, dropped } = verifyImportFacts(TEXT, [padded, wrongMajor]);
    const [p, e] = facts as unknown as [
      { payload: Record<string, unknown> },
      { payload: Record<string, unknown> },
    ];
    expect(p.payload.techStack).toEqual(["Spring Boot"]);
    expect((p.payload.highlights as unknown[]).length).toBe(2);
    expect(e.payload.major).toBeUndefined();
    expect(e.payload.rank).toBeUndefined();
    expect(e.payload.school).toBe("江城大学");
    expect(dropped.map((d) => d.field).sort()).toEqual(["highlights", "major", "rank", "techStack"]);
  });

  it("学历层次、年份不在原文里时丢掉该字段；条目名对不上就整条丢弃", () => {
    const { facts, dropped } = verifyImportFacts(TEXT, [
      { ...education, payload: { ...education.payload, degree: "master", start: "2021-09" } },
      { ...project, payload: { ...project.payload, name: "校园外卖平台" } },
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.payload).not.toHaveProperty("degree");
    expect(facts[0]?.payload).not.toHaveProperty("start");
    expect(dropped.find((d) => d.label === "校园外卖平台")?.field).toBeUndefined();
  });

  it("格式不合法的事实丢弃，不影响其他条", () => {
    const { facts, dropped } = verifyImportFacts(TEXT, [{ section: "projects", payload: {} }, skill, "x"]);
    expect(facts).toHaveLength(1);
    expect(dropped).toHaveLength(2);
  });
});

describe("applyImport + importOpening", () => {
  it("写入画像，开场直接问简历里缺的部分，不问已有的", () => {
    const state = createIntakeState();
    const { facts } = verifyImportFacts(TEXT, [basics, education, project, skill]);
    const result = applyImport(state, { messageId: "m1", text: TEXT, facts, genId: createIdGenerator() });
    expect(result.conflicts).toEqual([]);
    expect(state.profile.basics.phone).toBe("139-0000-1234");
    expect(state.profile.projects[0]?.highlights).toHaveLength(2);
    expect(state.facts.every((f) => f.sourceMessageId === "m1" && f.status === "confirmed")).toBe(true);

    const opening = importOpening(state, result, facts);
    expect(opening.text).toContain("我从你的简历里读到了 4 条信息");
    expect(opening.text).toContain("「校园食堂点餐小程序」");
    expect(opening.text).toMatch(/简历里(.*没写|还没有)/);
    expect(opening.text).not.toMatch(/手机号|邮箱是哪个|怎么称呼/);
    expect(opening.meta.slot).toBeTruthy();
    expect(state.askCounts[opening.meta.slot as string]).toBe(1);
    expect(opening.meta.changes?.length).toBeGreaterThan(0);
  });

  it("和已有画像冲突的进入待确认，不直接覆盖", () => {
    const state = createIntakeState({
      profile: Profile.parse({
        education: [
          { id: "e1", school: "江城大学", degree: "bachelor", major: "计算机科学", sourceFactIds: ["f0"] },
        ],
      }),
    });
    const { facts } = verifyImportFacts(TEXT, [education]);
    const result = applyImport(state, { messageId: "m1", text: TEXT, facts, genId: createIdGenerator() });
    expect(state.profile.education[0]?.major).toBe("计算机科学");
    expect(state.profile.education[0]?.gpa).toBe("3.6/4.0");
    expect(state.conflicts).toEqual([
      expect.objectContaining({ field: "major", previous: "计算机科学", proposed: "软件工程" }),
    ]);
    expect(state.facts.filter((f) => f.status === "pending")).toHaveLength(1);

    const opening = importOpening(state, result, facts);
    expect(opening.text).toContain("1 处和之前记录的不一样");
    expect(opening.meta.slot).toBeUndefined();
  });

  it("概述按分区汇总", () => {
    const { facts } = verifyImportFacts(TEXT, [basics, education, project, skill]);
    expect(describeImportGroups(groupImportFacts(facts))).toBe(
      "基本信息、教育经历「江城大学」、项目经历「校园食堂点餐小程序」、技能 1 项",
    );
  });
});
