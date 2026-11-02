import { describe, expect, it } from "vitest";
import {
  collectProfileSkills,
  extractJdSkills,
  scoreCity,
  scoreExperience,
  scoreMajor,
  scoreRole,
  scoreSkills,
} from "./dimensions.ts";
import { makeJob, makeProfile } from "./fixtures.ts";
import { buildScoreContext } from "./pipeline.ts";

const skill = (name: string, level?: "beginner" | "familiar" | "proficient" | "expert") => ({
  id: name,
  name,
  ...(level && { level }),
});

describe("技能维度", () => {
  it("同义词写法能命中 JD 要求，并给出证据", () => {
    const job = makeJob({ title: "前端开发", jdText: "【任职要求】\n熟悉JavaScript和Vue" });
    const res = scoreSkills(makeProfile({ skills: [skill("JS"), skill("vue3")] }), job);
    expect(res.score).toBe(1);
    expect(res.evidence.join("\n")).toContain("画像技能「JS」");
    expect(res.evidence.join("\n")).toContain("JD「");
  });

  it("加分项权重减半，缺失时只扣一半", () => {
    const job = makeJob({ title: "后端", jdText: "【任职要求】\n熟悉Java\n【加分项】\n了解Kubernetes" });
    const jd = extractJdSkills(job);
    expect(jd.find((s) => s.name === "Java")?.weight).toBe(1);
    expect(jd.find((s) => s.name === "Kubernetes")?.weight).toBe(0.5);
    const res = scoreSkills(makeProfile({ skills: [skill("Java")] }), job);
    expect(res.score).toBeCloseTo(1 / 1.5, 5);
    expect(res.evidence.join("\n")).toContain("缺少 Kubernetes");
  });

  it("「C/C++/Java/Go 其中一门」只要会一门就算满足", () => {
    const job = makeJob({ title: "后端", jdText: "熟练掌握C/C++/Java/Go等其中一门开发语言" });
    expect(scoreSkills(makeProfile({ skills: [skill("Golang")] }), job).score).toBe(1);
    expect(scoreSkills(makeProfile({ skills: [skill("Excel")] }), job).score).toBe(0);
  });

  it("项目技术栈与描述里的技能也算，课程只算半分，相近技能按 0.7 折算", () => {
    const job = makeJob({ title: "x", jdText: "熟悉Redis" });
    const fromProject = makeProfile({
      skills: [],
      projects: [{ id: "p", name: "秒杀", techStack: ["Redis"] }],
    });
    expect(scoreSkills(fromProject, job).score).toBe(1);
    const fromCourse = makeProfile({
      skills: [],
      education: [{ id: "e", school: "A", degree: "bachelor", courses: ["Redis原理"] }],
    });
    expect(scoreSkills(fromCourse, job).score).toBe(0.5);
    const ml = makeJob({ title: "x", jdText: "熟悉机器学习" });
    expect(scoreSkills(makeProfile({ skills: [skill("PyTorch")] }), ml).score).toBeCloseTo(0.7, 5);
  });

  it("熟悉程度影响得分；JD 没有技能要求时该维度不适用", () => {
    const owned = collectProfileSkills(makeProfile({ skills: [skill("Go", "familiar")] }));
    expect(owned.get("Go")?.credit).toBe(0.8);
    const beginner = collectProfileSkills(makeProfile({ skills: [skill("Go", "beginner")] }));
    expect(beginner.get("Go")?.credit).toBe(0.6);
    const res = scoreSkills(makeProfile(), makeJob({ title: "x", jdText: "沟通能力强，认真负责" }));
    expect(res.applicable).toBe(false);
  });
});

describe("专业维度", () => {
  it("JD 点名专业大类时按是否同类打分", () => {
    const job = makeJob({ title: "后端开发", jdText: "计算机、软件工程等相关专业本科及以上" });
    expect(scoreMajor(makeProfile(), job).score).toBe(1);
    const art = makeProfile({
      education: [{ id: "e", school: "A", degree: "bachelor", major: "视觉传达设计" }],
    });
    const res = scoreMajor(art, job);
    expect(res.score).toBeLessThan(0.3);
    expect(res.evidence[0]).toContain("视觉传达设计");
  });

  it("JD 没写专业时按岗位方向的对口专业判断", () => {
    const design = makeJob({ title: "视觉设计", jdText: "负责海报设计" });
    expect(scoreMajor(makeProfile(), design).score).toBeLessThan(0.3);
    const art = makeProfile({
      education: [{ id: "e", school: "A", degree: "bachelor", major: "数字媒体艺术" }],
    });
    expect(scoreMajor(art, design).score).toBeGreaterThan(0.8);
  });

  it("没有专业信息时不适用；「专业不限」给中等分", () => {
    const noMajor = makeProfile({ education: [{ id: "e", school: "A", degree: "bachelor" }] });
    expect(scoreMajor(noMajor, makeJob({ title: "后端开发" })).applicable).toBe(false);
    const open = makeJob({ title: "产品运营", jdText: "专业不限，热爱互联网" });
    expect(scoreMajor(makeProfile(), open).score).toBe(0.7);
  });
});

describe("项目/经历维度", () => {
  const jobs = [
    makeJob({ title: "推荐算法工程师", jdText: "负责推荐系统召回排序模型设计，特征工程与线上实验" }),
    makeJob({ title: "视觉设计", jdText: "负责品牌海报与界面视觉设计" }),
  ];
  const ctx = buildScoreContext(jobs);
  const profile = makeProfile({
    projects: [
      {
        id: "p",
        name: "信息流推荐",
        role: "算法",
        techStack: ["PyTorch"],
        action: "实现召回排序模型并做线上实验",
      },
    ],
  });

  it("关键词与方向相关的经历得分明显更高，并指出共有关键词", () => {
    const hit = scoreExperience(profile, jobs[0] as (typeof jobs)[number], ctx);
    const miss = scoreExperience(profile, jobs[1] as (typeof jobs)[number], ctx);
    expect(hit.score).toBeGreaterThan(miss.score + 0.3);
    expect(hit.evidence.join("\n")).toMatch(/项目「信息流推荐」.*共有关键词/);
  });

  it("没有任何项目或经历时得 0 且说明原因", () => {
    const res = scoreExperience(makeProfile(), jobs[0] as (typeof jobs)[number], ctx);
    expect(res).toMatchObject({ score: 0, applicable: true });
    expect(res.evidence[0]).toContain("还没有");
  });
});

describe("城市与意向岗位维度", () => {
  it("意向城市排位越靠前得分越高，不在意向内为 0", () => {
    const p = makeProfile({ intention: { roles: [], cities: ["北京", "上海"] } });
    expect(scoreCity(p, makeJob({ title: "a", cities: ["北京"] })).score).toBe(1);
    expect(scoreCity(p, makeJob({ title: "a", cities: ["上海"] })).score).toBe(0.9);
    expect(scoreCity(p, makeJob({ title: "a", cities: ["成都"] })).score).toBe(0);
  });

  it("没填意向城市时退回所在地，都没有则不适用", () => {
    const home = makeProfile({ intention: { roles: [], cities: [] }, basics: { city: "上海市" } });
    expect(scoreCity(home, makeJob({ title: "a", cities: ["上海"] })).score).toBe(0.8);
    const none = makeProfile({ intention: { roles: [], cities: [] } });
    expect(scoreCity(none, makeJob({ title: "a" })).applicable).toBe(false);
  });

  it("意向岗位：同类 1 分，相近按关联度，无关为 0，未填不适用", () => {
    const p = makeProfile({ intention: { roles: ["后端开发工程师"], cities: [] } });
    expect(scoreRole(p, makeJob({ title: "后台开发" })).score).toBe(1);
    const related = scoreRole(p, makeJob({ title: "全栈工程师" })).score;
    expect(related).toBeGreaterThan(0.4);
    expect(related).toBeLessThan(0.8);
    expect(scoreRole(p, makeJob({ title: "视觉设计" })).score).toBe(0);
    const none = makeProfile({ intention: { roles: [], cities: [] } });
    expect(scoreRole(none, makeJob({ title: "后台开发" })).applicable).toBe(false);
  });
});
