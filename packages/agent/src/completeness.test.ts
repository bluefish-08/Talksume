import { Profile } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { computeCompleteness, isQuantified, pickNextSlot } from "./completeness.ts";

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

  it("treats completed sections as fully scored", () => {
    const p = empty();
    const c = computeCompleteness(p, { completedSections: ["awards", "experiences"] });
    expect(c.sections.find((s) => s.section === "awards")?.score).toBe(1);
    expect(c.missing.some((m) => m.section === "awards")).toBe(false);
    expect(c.score).toBeGreaterThan(0);
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

  it("scores a one-line experience below 100% until it has 2 titled highlights and a tech stack", () => {
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
    const score = () => computeCompleteness(thin).sections.find((s) => s.section === "experiences")?.score;
    expect(score()).toBeLessThan(0.7);
    const exp = thin.experiences[0];
    if (!exp) throw new Error("no experience");
    exp.techStack = ["Java", "MySQL"];
    exp.highlights = [{ title: "订单模块", detail: "负责订单模块" }];
    expect(score()).toBeLessThan(1);
    exp.highlights.push({ title: "慢查询治理", detail: "接口 P99 从 600ms 降到 150ms" });
    expect(score()).toBe(1);
  });

  it("does not count untitled highlights converted from old bullets as deep-dived", () => {
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
      .missing.filter((m) => m.section === "projects")
      .map((m) => m.field);
    expect(fields).toEqual(expect.arrayContaining(["duty", "challenge"]));
    expect(fields).not.toContain("impact");
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
    expect(pickNextSlot(empty(), { completedSections: all })).toBeNull();
  });
});
