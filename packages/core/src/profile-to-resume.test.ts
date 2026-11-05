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
      school: "江城大学",
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

const rich = Profile.parse({
  basics: {
    name: "林知远",
    city: "江城",
    phone: "138-0000-0000",
    links: [{ label: "GitHub", url: "https://github.com/example-linzy" }, { url: "linzy.example.com" }],
    languages: ["CET-6 586"],
  },
  intention: { roles: ["后端开发工程师", "Go 开发"], jobType: "campus" },
  education: [
    {
      id: "e1",
      sourceFactIds: ["f1"],
      school: "江城大学",
      degree: "bachelor",
      major: "计算机科学与技术",
      city: "江城",
      gpa: "3.8/4.0",
      rank: "专业前 5%",
      honors: ["国家奖学金", " ", "校一等奖学金"],
      start: "2022-09",
      end: "2026-06",
    },
  ],
  experiences: [
    {
      id: "x1",
      sourceFactIds: ["f2"],
      kind: "internship",
      company: "星云科技",
      department: "交易平台部",
      title: "后端开发实习生",
      city: "上海",
      techStack: ["Java", "Redis"],
      bullets: ["这条会被 highlights 取代"],
      highlights: [{ title: "订单查询优化", detail: "P99 从 480ms 降至 120ms" }, { detail: "补齐单元测试" }],
      start: "2025-06",
      end: "2025-09",
    },
  ],
  projects: [
    {
      id: "p1",
      sourceFactIds: ["f3"],
      name: "MiniKV",
      action: "STAR 写法会被忽略",
      highlights: [{ title: "一致性", detail: "实现 Raft 选主与日志复制" }],
    },
  ],
  skills: [
    { id: "s1", sourceFactIds: ["s1"], name: "Java", category: "编程语言", level: "proficient" },
    { id: "s2", name: "Docker" },
    { id: "s3", name: "Go", category: "编程语言", level: "proficient" },
    { id: "s4", name: "MySQL", category: "数据库" },
    { id: "s5", name: "Rust", category: "编程语言" },
    { id: "s6", name: "Redis", category: "数据库" },
  ],
});

describe("profileToResume", () => {
  it("输出符合 ResumeContent schema，空画像只有空姓名且无分区", () => {
    expect(ResumeContent.safeParse(profileToResume(full)).success).toBe(true);
    expect(profileToResume(Profile.parse({}))).toEqual({ basics: { name: "", contacts: [] }, sections: [] });
  });

  it("基本信息：联系方式按城市、电话、邮箱排列", () => {
    expect(profileToResume(full).basics).toEqual({
      name: "李明",
      contacts: ["杭州", "13800000000", "liming@example.com"],
      summary: "后端方向",
    });
  });

  it("教育：学位中文化，GPA 与课程各成一条并带事实 ID", () => {
    const [item] = profileToResume(full).sections.find((s) => s.kind === "education")?.items ?? [];
    expect(item).toMatchObject({
      heading: "江城大学",
      subheading: "计算机科学与技术 · 本科",
      period: "2023.09 – 2027.06",
    });
    expect(item?.bullets).toEqual([
      { text: "GPA 3.8/4.0", factIds: ["f1"] },
      { lead: "主修课程", text: "数据结构、操作系统", factIds: ["f1"] },
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

  it("项目：STAR 压成三条，背景与任务合并并去掉结尾标点；技术栈单独成字段", () => {
    const [item] = profileToResume(full).sections.find((s) => s.kind === "projects")?.items ?? [];
    expect(item).toMatchObject({
      heading: "短链服务",
      subheading: "后端负责人",
      period: "2025.03 – 2025.06",
      techStack: ["Go", "Redis"],
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

  it("熟悉与了解是两档，分别按原话程度分组", () => {
    const profile = Profile.parse({
      skills: [
        { id: "a", name: "Go", level: "familiar" },
        { id: "b", name: "MySQL", level: "familiar" },
        { id: "c", name: "Python", level: "beginner" },
      ],
    });
    const section = profileToResume(profile).sections.find((s) => s.kind === "skills");
    expect(section?.items.map((i) => [i.heading, i.bullets[0]?.text])).toEqual([
      ["熟悉", "Go、MySQL"],
      ["了解", "Python"],
    ]);
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

  it("新字段：求职意向行、链接、外语、成绩排名、荣誉、城市", () => {
    const resume = profileToResume(rich);
    expect(resume.basics).toEqual({
      name: "林知远",
      headline: "2026 届 · 后端开发工程师 / Go 开发 · 校招",
      contacts: ["江城", "138-0000-0000"],
      links: [{ label: "GitHub", url: "https://github.com/example-linzy" }, { url: "linzy.example.com" }],
    });
    const [edu] = resume.sections.find((s) => s.kind === "education")?.items ?? [];
    expect(edu).toEqual({
      heading: "江城大学",
      subheading: "计算机科学与技术 · 本科",
      period: "2022.09 – 2026.06",
      meta: "江城",
      bullets: [
        { text: "GPA 3.8/4.0（专业前 5%），CET-6 586", factIds: ["f1"] },
        { lead: "荣誉奖项", text: "国家奖学金、校一等奖学金", factIds: ["f1"] },
      ],
    });
  });

  it("新字段：经历的部门、城市、技术栈，highlights 优先于 bullets 且带加粗短语", () => {
    const [exp] = profileToResume(rich).sections.find((s) => s.kind === "experiences")?.items ?? [];
    expect(exp).toEqual({
      heading: "星云科技",
      subheading: "交易平台部 · 后端开发实习生",
      period: "2025.06 – 2025.09",
      meta: "上海",
      techStack: ["Java", "Redis"],
      bullets: [
        { lead: "订单查询优化", text: "P99 从 480ms 降至 120ms", factIds: ["f2"] },
        { text: "补齐单元测试", factIds: ["f2"] },
      ],
    });
  });

  it("项目有 highlights 时不再用 STAR 拼要点", () => {
    const [project] = profileToResume(rich).sections.find((s) => s.kind === "projects")?.items ?? [];
    expect(project?.bullets).toEqual([{ lead: "一致性", text: "实现 Raft 选主与日志复制", factIds: ["f3"] }]);
  });

  it("技能有分组时按分组出条目，组内按熟练度分段，未分组的归「其他」并排最后", () => {
    const section = profileToResume(rich).sections.find((s) => s.kind === "skills");
    expect(section?.items).toEqual([
      {
        heading: "编程语言",
        bullets: [
          { lead: "熟练", text: "Java、Go", factIds: ["s1"] },
          { text: "Rust", factIds: [] },
        ],
      },
      { heading: "数据库", bullets: [{ text: "MySQL、Redis", factIds: [] }] },
      { heading: "其他", bullets: [{ text: "Docker", factIds: [] }] },
    ]);
    expect(section?.items[0] && skillLine(section.items[0]).text).toBe("熟练 Java、Go；Rust");
  });

  it("空字段不输出：空白城市、空技术栈、空要点、空白意向都不留键", () => {
    const sparse = profileToResume(
      Profile.parse({
        basics: { name: " 周以安 ", city: "  ", links: [{ url: " " }], languages: [] },
        intention: { roles: [" "], cities: [""] },
        experiences: [
          {
            id: "x",
            kind: "internship",
            company: "青禾数据",
            title: "实习生",
            city: " ",
            techStack: [" "],
            highlights: [{ title: "空", detail: "  " }],
          },
        ],
      }),
    );
    expect(sparse.basics).toEqual({ name: "周以安", contacts: [] });
    expect(sparse.sections[0]?.items[0]).toEqual({ heading: "青禾数据", subheading: "实习生", bullets: [] });
  });

  it("没有教育经历时外语进技能分区", () => {
    const resume = profileToResume(Profile.parse({ basics: { languages: ["CET-4"] } }));
    expect(resume.sections).toEqual([
      {
        kind: "skills",
        title: "专业技能",
        items: [{ heading: "语言能力", bullets: [{ text: "CET-4", factIds: [] }] }],
      },
    ]);
  });
});

describe("求职意向行", () => {
  const edu = { id: "e", school: "江城大学", degree: "bachelor", start: "2022-09", end: "2026-06" };
  const headline = (input: object) => profileToResume(Profile.parse(input)).basics.headline;

  it("完整意向：届别、岗位、类型、城市、到岗时间依次排列，岗位最多两个", () => {
    expect(
      headline({
        education: [edu],
        intention: {
          roles: ["后端开发", " ", "Go 开发", "数据开发"],
          jobType: "internship",
          cities: ["杭州", "上海"],
          availableFrom: "2026-07",
          salaryMin: 8000,
          salaryMax: 12000,
        },
      }),
    ).toBe("2026 届 · 后端开发 / Go 开发 · 实习 · 意向城市：杭州 / 上海 · 可于 2026.07 到岗");
  });

  it("期望薪资要打开开关才写", () => {
    const intention = { roles: ["后端开发"], salaryMin: 8500, salaryMax: 12000, showSalary: true };
    expect(headline({ intention })).toBe("后端开发 · 期望月薪 8.5k–12k");
    expect(headline({ intention: { ...intention, salaryMax: undefined } })).toBe(
      "后端开发 · 期望月薪 8.5k 起",
    );
    expect(headline({ intention: { ...intention, showSalary: false } })).toBe("后端开发");
  });

  it("只有部分字段时不留空段和多余分隔符", () => {
    expect(headline({ intention: { cities: [" ", "杭州"] } })).toBe("意向城市：杭州");
    expect(headline({ education: [edu], intention: { availableFrom: "2026-07" } })).toBe(
      "2026 届 · 可于 2026.07 到岗",
    );
    expect(headline({ education: [{ ...edu, end: "present" }], intention: { roles: ["后端开发"] } })).toBe(
      "后端开发",
    );
    expect(headline({ education: [edu], intention: { roles: ["后端开发"], jobType: "experienced" } })).toBe(
      "后端开发 · 社招",
    );
  });

  it("完全没有意向时不出这一行，只有毕业时间也不出", () => {
    expect(headline({ education: [edu] })).toBeUndefined();
    expect(headline({ intention: { roles: ["  "], cities: [], salaryMin: 8000 } })).toBeUndefined();
    expect("headline" in profileToResume(Profile.parse({ education: [edu] })).basics).toBe(false);
  });

  it("手动设置的 headline 优先", () => {
    expect(headline({ basics: { headline: " 求职：后端开发 " }, intention: { roles: ["前端开发"] } })).toBe(
      "求职：后端开发",
    );
  });
});

describe("校园经历", () => {
  it("kind=campus 的条目单列「校园经历」，排在项目经历之后", () => {
    const profile = Profile.parse({
      projects: [
        { id: "p1", name: "学生成绩管理系统", techStack: ["Java"] },
        { id: "p2", name: "计算机协会电脑义诊", kind: "campus", highlights: [{ detail: "负责现场登记" }] },
      ],
    });
    const sections = profileToResume(profile).sections;
    expect(sections.map((s) => [s.kind, s.title])).toEqual([
      ["projects", "项目经历"],
      ["campus", "校园经历"],
    ]);
    expect(sections[1]?.items[0]?.heading).toBe("计算机协会电脑义诊");
  });
});
