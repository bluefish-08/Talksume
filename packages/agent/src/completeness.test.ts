import { Profile } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { computeCompleteness, isQuantified, pickNextSlot, prepTips } from "./completeness.ts";

const empty = () => Profile.parse({});

function withBasics() {
  const p = empty();
  p.basics = { name: "李明", phone: "13800001111", email: "a@b.com", city: "上海", summary: "后端新人" };
  return p;
}

function withEducation(p: Profile) {
  p.education.push({
    id: "edu_1",
    sourceFactIds: [],
    school: "上海交通大学",
    degree: "bachelor",
    major: "计算机",
    courses: [],
    start: "2021-09",
    end: "2025-06",
  });
  return p;
}

describe("computeCompleteness", () => {
  it("scores an empty profile at 0 and lists required gaps", () => {
    const c = computeCompleteness(empty());
    expect(c.score).toBe(0);
    expect(c.missing.some((m) => m.key === "basics:_:name" && m.required)).toBe(true);
    expect(c.missing.some((m) => m.kind === "new_item" && m.section === "education")).toBe(true);
  });

  it("increases monotonically as fields are filled", () => {
    const p = empty();
    const a = computeCompleteness(p).score;
    p.basics.name = "李明";
    const b = computeCompleteness(p).score;
    withEducation(p);
    const c = computeCompleteness(p).score;
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(1);
  });

  it("weights required fields higher than optional ones", () => {
    const withName = empty();
    withName.basics.name = "李明";
    const withCity = empty();
    withCity.basics.city = "上海";
    expect(computeCompleteness(withName).score).toBeGreaterThan(computeCompleteness(withCity).score);
  });

  it("counts completed sections as asked, not as written", () => {
    const p = empty();
    const c = computeCompleteness(p, { completedSections: ["awards", "experiences"] });
    const awards = c.sections.find((s) => s.section === "awards");
    expect(awards).toMatchObject({ completed: true, score: 0 });
    expect(c.missing.some((m) => m.section === "awards")).toBe(false);
    expect(c.score).toBe(0);
    expect(c.progress).toBeGreaterThan(0);
  });

  it("keeps a resume with only education and skills low even when everything else was skipped", () => {
    const p = withEducation(empty());
    p.skills.push(
      ...["Java", "MySQL", "Git"].map((name, i) => ({ id: `skl_${i}`, sourceFactIds: [], name })),
    );
    const skippedAll = ["basics", "experiences", "projects", "awards", "intention"] as const;
    const c = computeCompleteness(p, { completedSections: skippedAll });
    expect(c.progress).toBeGreaterThan(0.95);
    expect(c.score).toBeLessThan(0.3);
    expect(c.gaps[0]).toMatchObject({ key: "evidence", label: "能证明动手能力的经历" });
  });

  it("caps a complete-looking resume without any experience below half", () => {
    const p = thinStudent();
    const c = computeCompleteness(p, { completedSections: ["experiences", "projects", "awards"] });
    expect(c.score).toBeLessThan(0.5);
    expect(c.gaps.map((g) => g.key)).toEqual(["evidence"]);
    expect(c.tips.length).toBeGreaterThan(0);
  });

  it("scores a resume with two well-told experiences high and stops suggesting", () => {
    const p = thinStudent();
    p.experiences.push({
      id: "exp_1",
      sourceFactIds: [],
      kind: "internship",
      company: "示例科技",
      title: "后端实习",
      techStack: ["Java", "MySQL"],
      bullets: [],
      highlights: [
        { title: "订单接口", detail: "负责订单查询接口" },
        { title: "慢查询优化", detail: "排查慢查询加了联合索引，响应从 800ms 降到 120ms" },
      ],
    });
    p.projects.push({
      id: "prj_1",
      sourceFactIds: [],
      name: "校园二手平台",
      role: "后端",
      situation: "课余和同学做的",
      techStack: ["Spring Boot"],
      highlights: [
        { title: "商品发布", detail: "负责商品发布模块" },
        { title: "超卖问题", detail: "用乐观锁解决了超卖，上线后 300 人注册" },
      ],
    });
    p.awards.push({ id: "awd_1", sourceFactIds: [], name: "校二等奖学金" });
    const c = computeCompleteness(p);
    expect(c.score).toBeGreaterThan(0.9);
    expect(c.gaps).toEqual([]);
    expect(c.tips).toEqual([]);
  });

  it("asks for a second experience and the details of a bare one", () => {
    const p = thinStudent();
    p.projects.push({ id: "prj_1", sourceFactIds: [], name: "成绩管理系统", techStack: [] });
    const keys = computeCompleteness(p).gaps.map((g) => g.key);
    expect(keys).toEqual(["evidence_more", "thin:prj_1"]);
  });

  it("needs a quantified highlight for the impact item", () => {
    const p = empty();
    p.projects.push({
      id: "prj_1",
      sourceFactIds: [],
      name: "短链服务",
      techStack: [],
      highlights: [{ title: "短链生成", detail: "性能提升很明显" }],
    });
    const quantify = computeCompleteness(p).missing.find((m) => m.kind === "quantify");
    expect(quantify).toMatchObject({ field: "impact", itemId: "prj_1" });
    p.projects[0]?.highlights?.push({ title: "缓存优化", detail: "QPS 从 200 提升到 3000" });
    expect(computeCompleteness(p).missing.some((m) => m.kind === "quantify")).toBe(false);
  });

  it("keeps a thin old experience below 100% but counts what it already answered", () => {
    const thin = Profile.parse({
      experiences: [
        {
          id: "exp_1",
          kind: "internship",
          company: "示例科技",
          title: "后端开发实习生",
          start: "2025-07",
          end: "2025-09",
          bullets: ["负责订单模块", "修复缺陷 30 个"],
        },
      ],
    });
    const c = () => computeCompleteness(thin);
    const missingFields = () => c().missing.map((m) => m.field);
    expect(c().sections.find((s) => s.section === "experiences")?.score).toBeLessThan(1);
    expect(missingFields()).toEqual(expect.arrayContaining(["techStack", "challenge"]));
    expect(missingFields()).not.toContain("duty");
    expect(missingFields()).not.toContain("impact");
    const exp = thin.experiences[0];
    if (!exp) throw new Error("no experience");
    exp.techStack = ["Java", "MySQL"];
    exp.highlights = [
      { detail: "负责订单模块" },
      { detail: "修复缺陷 30 个" },
      { title: "慢查询治理", detail: "解决了大促时的慢查询" },
    ];
    expect(c().sections.find((s) => s.section === "experiences")?.score).toBe(1);
  });

  it("treats an old project's action and result as answered duty and numbers", () => {
    const p = Profile.parse({
      projects: [
        {
          id: "prj_old",
          name: "江城闲置",
          role: "后端负责人",
          techStack: ["Java"],
          action: "负责后端，做了商品发布、搜索和订单模块",
          result: "接口响应从 800ms 降到 120ms",
        },
      ],
    });
    const fields = computeCompleteness(p)
      .missing.filter((m) => m.section === "projects" && m.required)
      .map((m) => m.field);
    expect(fields).toEqual(["challenge"]);
  });

  it("counts untitled highlights as answered too", () => {
    const p = Profile.parse({
      projects: [
        {
          id: "prj_1",
          name: "x",
          role: "后端",
          techStack: ["Go"],
          highlights: [{ detail: "做了 a" }, { detail: "做了 b，提升 20%" }],
        },
      ],
    });
    const fields = computeCompleteness(p)
      .missing.filter((m) => m.section === "projects" && m.required)
      .map((m) => m.field);
    expect(fields).toEqual(["challenge"]);
  });

  it("accepts either GPA or rank for education", () => {
    const p = withEducation(empty());
    const has = () => computeCompleteness(p).missing.some((m) => m.field === "gpa");
    expect(has()).toBe(true);
    const edu = p.education[0];
    if (!edu) throw new Error("no education");
    edu.rank = "专业前 10%";
    expect(has()).toBe(false);
    expect(computeCompleteness(p).missing.find((m) => m.field === "gpa")?.required).toBeUndefined();
  });

  it("recognizes quantified text", () => {
    expect(isQuantified("提升 30%")).toBe(true);
    expect(isQuantified("服务了三百人")).toBe(true);
    expect(isQuantified("服务了很多用户")).toBe(false);
    expect(isQuantified("响应时间降低了2倍")).toBe(true);
    expect(isQuantified("做得不错")).toBe(false);
  });

  it("ignores digits that are part of a name like UTF-8 or Vue3", () => {
    expect(isQuantified("把数据库和连接的编码都改成 UTF-8")).toBe(false);
    expect(isQuantified("用 Vue3 和 Python3.10 重写，密码 MD5 加密")).toBe(false);
    expect(isQuantified("改成 UTF-8 后乱码从 20 条降到 0")).toBe(true);
    expect(isQuantified("QPS 提升到 3000")).toBe(true);
  });
});

function thinStudent() {
  const p = withEducation(withBasics());
  p.skills.push(...["Java", "MySQL", "Git"].map((name, i) => ({ id: `skl_${i}`, sourceFactIds: [], name })));
  p.intention = { roles: ["Java 开发"], cities: ["江城"], jobType: "campus" };
  return p;
}

describe("prepTips", () => {
  it("suggests projects in the student's direction, and nothing once experience is enough", () => {
    expect(prepTips(thinStudent()).join("")).toContain("Spring Boot");
    const front = thinStudent();
    front.intention.roles = ["前端开发"];
    expect(prepTips(front).join("")).toContain("Vue");
    expect(prepTips(empty()).length).toBeGreaterThan(0);
  });
});

describe("probing for experience", () => {
  const skippedProjects = { completedSections: ["experiences", "projects"] as const };

  it("digs from another angle right after the student says there are no projects", () => {
    const slot = pickNextSlot(thinStudent(), skippedProjects);
    expect(slot).toMatchObject({ kind: "probe", field: "probe_course" });
    expect(slot?.question).toContain("Java");
    expect(slot?.replies).toEqual(["做过", "没做过"]);
  });

  it("proposes a course the student already mentioned", () => {
    const p = thinStudent();
    const edu = p.education[0];
    if (!edu) throw new Error("no education");
    edu.courses = ["数据库原理"];
    expect(pickNextSlot(p, skippedProjects)?.question).toContain("「数据库原理」");
  });

  it("asks each angle once and gives up only after all were declined", () => {
    const p = thinStudent();
    const skipped = new Set<string>();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const slot = pickNextSlot(p, { ...skippedProjects, skipped });
      expect(slot?.kind).toBe("probe");
      seen.push(slot?.field ?? "");
      skipped.add(slot?.key ?? "");
    }
    expect(seen).toEqual(["probe_course", "probe_selfmade", "probe_campus", "probe_work"]);
    expect(pickNextSlot(p, { ...skippedProjects, skipped })?.kind).not.toBe("probe");
  });

  it("skips angles an experience already covers and waits until the one experience is dug", () => {
    const p = thinStudent();
    p.projects.push({
      id: "prj_1",
      sourceFactIds: [],
      name: "Java 课程设计：成绩管理系统",
      role: "组员",
      techStack: [],
    });
    const c = computeCompleteness(p);
    expect(c.missing.filter((m) => m.kind === "probe").map((m) => m.field)).toEqual([
      "probe_selfmade",
      "probe_campus",
      "probe_work",
    ]);
    expect(pickNextSlot(p, { completedSections: ["experiences", "awards"] })).toMatchObject({
      itemId: "prj_1",
      field: "techStack",
    });
    const dug = new Set(
      ["prj_1:techStack", "prj_1:duty", "prj_1:challenge", "prj_1:impact"].map((k) => `projects:${k}`),
    );
    expect(pickNextSlot(p, { completedSections: ["experiences", "awards"], skipped: dug })).toMatchObject({
      kind: "probe",
      field: "probe_selfmade",
    });
  });

  it("stops probing once there are two experiences", () => {
    const p = thinStudent();
    p.projects.push(
      { id: "prj_1", sourceFactIds: [], name: "成绩管理系统", techStack: [] },
      { id: "prj_2", sourceFactIds: [], name: "电脑义诊", techStack: [] },
    );
    expect(computeCompleteness(p).missing.some((m) => m.kind === "probe")).toBe(false);
  });
});

describe("pickNextSlot", () => {
  it("starts with the heaviest required basics field", () => {
    expect(pickNextSlot(empty())?.key).toBe("basics:_:name");
  });

  it("moves on to education once required basics are filled", () => {
    const p = withBasics();
    const slot = pickNextSlot(p);
    expect(slot).toMatchObject({ section: "education", kind: "new_item" });
  });

  it("asks required fields of every section before optional ones", () => {
    const p = withEducation(withBasics());
    p.basics.city = undefined;
    const slot = pickNextSlot(p, { completedSections: [] });
    expect(slot).toMatchObject({ section: "experiences", kind: "new_item" });
  });

  it("lays out every section before digging into any experience", () => {
    const p = withEducation(withBasics());
    p.projects.push({ id: "prj_1", sourceFactIds: [], name: "校园二手平台", role: "后端", techStack: [] });
    const opts = { completedSections: ["experiences", "awards"] as const };
    expect(pickNextSlot(p, opts)?.section).toBe("skills");
    p.skills.push(
      ...["Java", "MySQL", "Redis"].map((name, i) => ({ id: `skl_${i}`, sourceFactIds: [], name })),
    );
    expect(pickNextSlot(p, opts)?.section).toBe("intention");
    p.intention = { roles: ["后端开发"], cities: ["杭州"], jobType: "campus" };
    expect(pickNextSlot(p, opts)).toMatchObject({ section: "projects", field: "techStack", depth: 1 });
  });

  it("digs each experience in order: tech stack, duty, challenge, then numbers", () => {
    const p = withEducation(withBasics());
    p.experiences.push({
      id: "exp_1",
      sourceFactIds: [],
      kind: "internship",
      company: "示例科技",
      title: "后端实习",
      bullets: [],
    });
    p.projects.push({ id: "prj_1", sourceFactIds: [], name: "短链服务", role: "后端", techStack: [] });
    const opts = { completedSections: ["skills", "intention", "awards"] as const };
    const exp = p.experiences[0];
    if (!exp) throw new Error("no experience");
    expect(pickNextSlot(p, opts)).toMatchObject({ itemId: "exp_1", field: "techStack" });
    exp.techStack = ["Java"];
    expect(pickNextSlot(p, opts)).toMatchObject({ itemId: "exp_1", field: "duty", kind: "deepen" });
    exp.highlights = [{ title: "订单查询重构", detail: "把多表联查拆成按用户分片查询" }];
    expect(pickNextSlot(p, opts)).toMatchObject({ itemId: "exp_1", field: "challenge" });
    exp.highlights.push({ title: "后台权限", detail: "还做了后台的权限管理" });
    expect(pickNextSlot(p, opts)).toMatchObject({ itemId: "exp_1", field: "challenge" });
    exp.highlights.push({ title: "缓存一致性", detail: "用消息队列异步更新缓存，解决了缓存不一致" });
    const impact = pickNextSlot(p, opts);
    expect(impact).toMatchObject({ itemId: "exp_1", field: "impact", kind: "quantify" });
    expect(impact?.replies).toContain("没有具体数字");
    expect(pickNextSlot(p, { ...opts, skipped: new Set([impact?.key ?? ""]) })).toMatchObject({
      itemId: "prj_1",
      field: "techStack",
    });
  });

  it("finishes the experience being talked about before going back to an older one", () => {
    const p = withEducation(withBasics());
    p.projects.push(
      {
        id: "prj_old",
        sourceFactIds: [],
        name: "江城闲置",
        role: "后端",
        techStack: ["Java"],
        action: "做了订单模块",
      },
      { id: "prj_new", sourceFactIds: [], name: "江城图书馆", role: "组长", techStack: [] },
    );
    const opts = { completedSections: ["experiences", "skills", "intention", "awards"] as const };
    expect(pickNextSlot(p, opts)).toMatchObject({ itemId: "prj_old", field: "challenge" });
    expect(pickNextSlot(p, { ...opts, focusItemId: "prj_new" })).toMatchObject({
      itemId: "prj_new",
      field: "techStack",
    });
  });

  it("stops asking about a field after the ask limit, and numbers only once", () => {
    const p = empty();
    const first = pickNextSlot(p);
    expect(first?.key).toBe("basics:_:name");
    const skipped = pickNextSlot(p, { askCounts: { "basics:_:name": 2 } });
    expect(skipped?.key).not.toBe("basics:_:name");

    const q = withEducation(withBasics());
    q.projects.push({
      id: "prj_1",
      sourceFactIds: [],
      name: "x",
      role: "r",
      techStack: ["Go"],
      highlights: [
        { title: "a", detail: "做了 a" },
        { title: "b", detail: "解决了 b 的问题" },
      ],
    });
    const opts = { completedSections: ["experiences", "skills", "intention", "awards"] as const };
    expect(pickNextSlot(q, opts)?.kind).toBe("quantify");
    expect(pickNextSlot(q, { ...opts, askCounts: { "projects:prj_1:impact": 1 } })?.kind).not.toBe(
      "quantify",
    );
    const legacy = new Set(["projects:prj_1:result_quantified"]);
    expect(pickNextSlot(q, { ...opts, skipped: legacy })?.kind).not.toBe("quantify");
  });

  it("returns null when everything has been asked or completed", () => {
    const all = ["basics", "education", "experiences", "projects", "skills", "awards", "intention"] as const;
    const probes = computeCompleteness(empty()).missing.filter((m) => m.kind === "probe");
    const skipped = new Set(probes.map((m) => m.key));
    expect(pickNextSlot(empty(), { completedSections: all })?.kind).toBe("probe");
    expect(pickNextSlot(empty(), { completedSections: all, skipped })).toBeNull();
  });
});

describe("campus items", () => {
  it("does not ask for a tech stack on a campus activity", () => {
    const profile = Profile.parse({
      projects: [
        {
          id: "p1",
          name: "计算机协会电脑义诊",
          kind: "campus",
          role: "现场登记",
          highlights: [{ detail: "负责现场登记" }],
        },
        { id: "p2", name: "学生成绩管理系统", role: "成员" },
      ],
    });
    const keys = computeCompleteness(profile).missing.map((m) => m.key);
    expect(keys).not.toContain("projects:p1:techStack");
    expect(keys).toContain("projects:p2:techStack");
  });
});
