import { describe, expect, it } from "vitest";
import { Profile } from "./profile.ts";
import { profileToResume, skillLine } from "./profile-to-resume.ts";
import { ResumeContent } from "./resume.ts";

const full = Profile.parse({
  basics: {
    name: "李明",
    phone: "13800000000",
    email: "liming@example.com",
    city: "杭州",
    summary: "后端方向",
  },
  education: [
    {
      id: "edu_1",
      sourceFactIds: ["f1"],
      school: "浙江大学",
      degree: "bachelor",
      major: "计算机科学与技术",
      gpa: "3.8/4.0",
      courses: ["数据结构", "操作系统"],
      start: "2023-09",
      end: "2027-06",
    },
  ],
  experiences: [
    {
      id: "exp_old",
      sourceFactIds: ["f2"],
      kind: "internship",
      company: "甲公司",
      title: "后端实习生",
      bullets: ["优化接口，P99 降低 60%"],
      start: "2024-07",
      end: "2024-09",
    },
    {
      id: "exp_now",
      sourceFactIds: ["f3"],
      kind: "internship",
      company: "乙公司",
      title: "Go 开发实习生",
      bullets: [],
      start: "2025-07",
      end: "present",
    },
  ],
  projects: [
    {
      id: "prj_1",
      sourceFactIds: ["f4"],
      name: "短链服务",
      role: "后端负责人",
      techStack: ["Go", "Redis"],
      situation: "活动期间短链跳转慢，",
      task: "需要支撑高并发",
      action: "用 Go 和 Redis 实现核心服务",
      result: "QPS 从 200 提升到 3000",
      start: "2025-03",
      end: "2025-06",
    },
  ],
  skills: [
    { id: "skl_1", sourceFactIds: ["f5"], name: "Go", level: "proficient" },
    { id: "skl_2", sourceFactIds: ["f6"], name: "Redis", level: "proficient" },
    { id: "skl_3", sourceFactIds: [], name: "Docker" },
  ],
  awards: [
    { id: "awd_1", sourceFactIds: ["f7"], name: "校一等奖学金", date: "2024-10", description: "专业前 5%" },
  ],
});

describe("profileToResume", () => {
  it("输出符合 ResumeContent schema，空画像只有空姓名且无分区", () => {
    expect(ResumeContent.safeParse(profileToResume(full)).success).toBe(true);
    expect(profileToResume(Profile.parse({}))).toEqual({ basics: { name: "", contacts: [] }, sections: [] });
  });

  it("基本信息：联系方式按电话、邮箱、城市排列", () => {
    expect(profileToResume(full).basics).toEqual({
      name: "李明",
      contacts: ["13800000000", "liming@example.com", "杭州"],
      summary: "后端方向",
    });
  });

  it("教育：学位中文化，GPA 与课程各成一条并带事实 ID", () => {
    const [item] = profileToResume(full).sections.find((s) => s.kind === "education")?.items ?? [];
    expect(item).toMatchObject({
      heading: "浙江大学",
      subheading: "计算机科学与技术 本科",
      period: "2023.09 – 2027.06",
    });
    expect(item?.bullets).toEqual([
      { text: "GPA 3.8/4.0", factIds: ["f1"] },
      { text: "核心课程：数据结构、操作系统", factIds: ["f1"] },
    ]);
  });

  it("经历按时间倒序，至今写作「至今」，空 bullets 保留条目", () => {
    const section = profileToResume(full).sections.find((s) => s.kind === "experiences");
    expect(section?.title).toBe("实习经历");
    expect(section?.items.map((i) => [i.heading, i.period])).toEqual([
      ["乙公司", "2025.07 – 至今"],
      ["甲公司", "2024.07 – 2024.09"],
    ]);
    expect(section?.items[1]?.bullets).toEqual([{ text: "优化接口，P99 降低 60%", factIds: ["f2"] }]);
  });

  it("实习与全职混排时分区标题随之变化", () => {
    const mixed = Profile.parse({
      experiences: [
        { id: "a", kind: "internship", company: "A", title: "实习" },
        { id: "b", kind: "fulltime", company: "B", title: "工程师" },
      ],
    });
    expect(profileToResume(mixed).sections[0]?.title).toBe("实习与工作经历");
    const work = Profile.parse({
      experiences: [{ id: "b", kind: "fulltime", company: "B", title: "工程师" }],
    });
    expect(profileToResume(work).sections[0]?.title).toBe("工作经历");
  });

  it("项目：STAR 压成三条，背景与任务合并并去掉结尾标点", () => {
    const [item] = profileToResume(full).sections.find((s) => s.kind === "projects")?.items ?? [];
    expect(item).toMatchObject({
      heading: "短链服务",
      subheading: "后端负责人 · Go / Redis",
      period: "2025.03 – 2025.06",
    });
    expect(item?.bullets.map((b) => b.text)).toEqual([
      "活动期间短链跳转慢，需要支撑高并发",
      "用 Go 和 Redis 实现核心服务",
      "QPS 从 200 提升到 3000",
    ]);
    expect(item?.bullets.every((b) => b.factIds[0] === "f4")).toBe(true);
  });

  it("项目缺少部分 STAR 字段时只输出已有的条目", () => {
    const partial = Profile.parse({ projects: [{ id: "p", name: "demo", result: "上线 3 个月 1000 用户" }] });
    const [item] = profileToResume(partial).sections[0]?.items ?? [];
    expect(item?.bullets.map((b) => b.text)).toEqual(["上线 3 个月 1000 用户"]);
    expect(item?.subheading).toBeUndefined();
    expect(item?.period).toBeUndefined();
  });

  it("技能一个熟练度一个条目，无等级的归入「其他」", () => {
    const section = profileToResume(full).sections.find((s) => s.kind === "skills");
    expect(section?.items).toEqual([
      { heading: "熟练", bullets: [{ text: "Go、Redis", factIds: ["f5", "f6"] }] },
      { heading: "其他", bullets: [{ text: "Docker", factIds: [] }] },
    ]);
  });

  it("技能都没有等级时不加前缀；familiar 显示为「熟悉」", () => {
    const skillsOf = (skills: object[]) =>
      profileToResume(Profile.parse({ skills })).sections.find((s) => s.kind === "skills")?.items;
    expect(
      skillsOf([
        { id: "a", name: "Go" },
        { id: "b", name: "Python" },
      ]),
    ).toEqual([{ heading: "", bullets: [{ text: "Go、Python", factIds: [] }] }]);
    expect(skillsOf([{ id: "a", name: "Go", level: "familiar" }])?.[0]?.heading).toBe("熟悉");
  });

  it("skillLine 把条目压成一行", () => {
    expect(skillLine({ heading: "熟悉", bullets: [{ text: "Go、MySQL", factIds: [] }] })).toEqual({
      label: "熟悉",
      text: "Go、MySQL",
    });
    expect(skillLine({ heading: "", bullets: [{ text: "Python", factIds: [] }] }).label).toBe("");
  });

  it("获奖：日期作 period，描述作 bullet", () => {
    const section = profileToResume(full).sections.find((s) => s.kind === "awards");
    expect(section?.items).toEqual([
      {
        heading: "校一等奖学金",
        period: "2024.10",
        bullets: [{ text: "专业前 5%", factIds: ["f7"] }],
      },
    ]);
  });

  it("分区顺序固定，空分区被省略", () => {
    expect(profileToResume(full).sections.map((s) => s.kind)).toEqual([
      "education",
      "experiences",
      "projects",
      "skills",
      "awards",
    ]);
    const onlySkills = Profile.parse({ skills: [{ id: "s", name: "Go" }] });
    expect(profileToResume(onlySkills).sections.map((s) => s.kind)).toEqual(["skills"]);
  });
});
