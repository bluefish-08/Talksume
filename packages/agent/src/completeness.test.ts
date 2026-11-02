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

  it("flags an unquantified project result", () => {
    const p = empty();
    p.projects.push({
      id: "prj_1",
      sourceFactIds: [],
      name: "短链服务",
      techStack: [],
      result: "性能提升很明显",
    });
    const quantify = computeCompleteness(p).missing.find((m) => m.kind === "quantify");
    expect(quantify?.field).toBe("result_quantified");
    const first = p.projects[0];
    if (first) first.result = "QPS 从 200 提升到 3000";
    expect(computeCompleteness(p).missing.some((m) => m.kind === "quantify")).toBe(false);
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
    expect(slot?.required).toBe(true);
    expect(slot?.section).not.toBe("basics");
  });

  it("pushes a project through STAR: action, then result, then quantification", () => {
    const p = withEducation(withBasics());
    p.projects.push({ id: "prj_1", sourceFactIds: [], name: "短链服务", role: "后端", techStack: [] });
    const opts = { completedSections: ["experiences", "skills", "intention", "awards"] as const };
    expect(pickNextSlot(p, opts)?.field).toBe("action");
    const first = p.projects[0];
    if (!first) throw new Error("no project");
    first.action = "设计了分片和缓存";
    expect(pickNextSlot(p, opts)?.field).toBe("result");
    first.result = "上线后运行稳定";
    const quantify = pickNextSlot(p, opts);
    expect(quantify).toMatchObject({ field: "result_quantified", kind: "quantify", itemLabel: "短链服务" });
    expect(quantify?.strategy).toContain("数字");
    first.result = "QPS 从 200 提升到 3000";
    expect(pickNextSlot(p, opts)?.section).not.toBe("projects");
  });

  it("stops asking about a field after the ask limit, and quantification only once", () => {
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
      techStack: [],
      action: "a",
      result: "没数字",
    });
    const opts = { completedSections: ["experiences", "skills", "intention", "awards"] as const };
    expect(pickNextSlot(q, opts)?.kind).toBe("quantify");
    expect(pickNextSlot(q, { ...opts, askCounts: { "projects:prj_1:result_quantified": 1 } })?.kind).not.toBe(
      "quantify",
    );
  });

  it("returns null when everything has been asked or completed", () => {
    const all = ["basics", "education", "experiences", "projects", "skills", "awards", "intention"] as const;
    expect(pickNextSlot(empty(), { completedSections: all })).toBeNull();
  });
});
