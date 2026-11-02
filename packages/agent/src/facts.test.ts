import { Profile } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { applyFacts, resolveConflict } from "./facts.ts";
import type { FactInput } from "./schemas.ts";

let counter = 0;
const genId = (prefix: string) => `${prefix}_${++counter}`;
const ctx = { messageId: "m1", genId };

const fact = (section: FactInput["section"], payload: Record<string, unknown>, quote = "原话") =>
  ({ section, payload, quote }) as FactInput;

describe("applyFacts", () => {
  it("writes basics and creates confirmed fact records with the quote and message id", () => {
    const base = Profile.parse({});
    const result = applyFacts(
      base,
      [fact("basics", { name: "李明", city: "上海" }, "我叫李明，在上海")],
      ctx,
    );
    expect(result.profile.basics).toMatchObject({ name: "李明", city: "上海" });
    expect(base.basics.name).toBeUndefined();
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      section: "basics",
      quote: "我叫李明，在上海",
      sourceMessageId: "m1",
      status: "confirmed",
    });
    expect(result.changes.map((c) => c.field).sort()).toEqual(["city", "name"]);
  });

  it("creates list items whose sourceFactIds point at the fact", () => {
    const result = applyFacts(
      Profile.parse({}),
      [fact("education", { school: "上海交通大学", degree: "bachelor", major: "计算机" })],
      ctx,
    );
    const item = result.profile.education[0];
    expect(item?.school).toBe("上海交通大学");
    expect(item?.sourceFactIds).toEqual([result.facts[0]?.id]);
    expect(item?.id).toMatch(/^edu_/);
  });

  it("merges later facts into the same item and appends the source fact", () => {
    const first = applyFacts(
      Profile.parse({}),
      [fact("projects", { name: "短链服务", techStack: ["Go"] })],
      ctx,
    );
    const second = applyFacts(
      first.profile,
      [fact("projects", { name: " 短链服务 ", techStack: ["Redis", "Go"], result: "QPS 提升到 3000" })],
      ctx,
    );
    expect(second.profile.projects).toHaveLength(1);
    const project = second.profile.projects[0];
    expect(project?.techStack).toEqual(["Go", "Redis"]);
    expect(project?.result).toBe("QPS 提升到 3000");
    expect(project?.sourceFactIds).toHaveLength(2);
    expect(project?.sourceFactIds).toContain(second.facts[0]?.id);
  });

  it("rejects new items missing required core fields with a useful reason", () => {
    const result = applyFacts(Profile.parse({}), [fact("education", { school: "清华大学" })], ctx);
    expect(result.profile.education).toHaveLength(0);
    expect(result.facts).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("degree");
  });

  it("rejects invalid payloads", () => {
    const result = applyFacts(
      Profile.parse({}),
      [fact("education", { school: "清华大学", degree: "本科" })],
      ctx,
    );
    expect(result.rejected).toHaveLength(1);
    expect(result.profile.education).toHaveLength(0);
  });

  it("batches several facts and keeps going after a rejected one", () => {
    const result = applyFacts(
      Profile.parse({}),
      [
        fact("education", { school: "清华大学" }),
        fact("skills", { name: "Go" }),
        fact("skills", { name: "Python", level: "proficient" }),
      ],
      ctx,
    );
    expect(result.rejected.map((r) => r.index)).toEqual([0]);
    expect(result.profile.skills.map((s) => s.name)).toEqual(["Go", "Python"]);
  });

  it("turns a contradicting scalar into a pending fact instead of overwriting", () => {
    const base = applyFacts(Profile.parse({}), [fact("basics", { name: "李明", city: "上海" })], ctx).profile;
    const result = applyFacts(
      base,
      [fact("basics", { city: "杭州", email: "a@b.com" }, "其实我在杭州")],
      ctx,
    );
    expect(result.profile.basics.city).toBe("上海");
    expect(result.profile.basics.email).toBe("a@b.com");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ field: "city", previous: "上海", proposed: "杭州" });
    const pending = result.facts.find((f) => f.status === "pending");
    expect(pending?.payload).toEqual({ city: "杭州" });
    expect(result.facts.find((f) => f.status === "confirmed")?.payload).toEqual({ email: "a@b.com" });
  });

  it("does not flag a conflict for equal values or unioned arrays", () => {
    const base = applyFacts(
      Profile.parse({}),
      [fact("intention", { roles: ["后端"], cities: ["杭州"] })],
      ctx,
    ).profile;
    const result = applyFacts(base, [fact("intention", { roles: ["后端", "数据"], cities: ["杭州"] })], ctx);
    expect(result.conflicts).toHaveLength(0);
    expect(result.profile.intention.roles).toEqual(["后端", "数据"]);
  });

  it("flags a conflict inside a list item", () => {
    const base = applyFacts(
      Profile.parse({}),
      [fact("experiences", { company: "字节跳动", title: "后端实习生", kind: "internship" })],
      ctx,
    ).profile;
    const result = applyFacts(base, [fact("experiences", { company: "字节跳动", title: "前端实习生" })], ctx);
    expect(result.conflicts[0]).toMatchObject({
      section: "experiences",
      field: "title",
      previous: "后端实习生",
    });
    expect(result.conflicts[0]?.itemId).toBe(base.experiences[0]?.id);
  });
});

describe("resolveConflict", () => {
  function setup() {
    const first = applyFacts(Profile.parse({}), [fact("basics", { city: "上海" })], ctx);
    const second = applyFacts(first.profile, [fact("basics", { city: "杭州" })], ctx);
    const facts = [...first.facts, ...second.facts];
    const conflict = second.conflicts[0];
    if (!conflict) throw new Error("expected conflict");
    return { profile: second.profile, facts, conflict };
  }

  it("accepting overwrites the value and supersedes the old fact", () => {
    const { profile, facts, conflict } = setup();
    const out = resolveConflict(profile, facts, conflict, true);
    expect(out.profile.basics.city).toBe("杭州");
    expect(out.facts.map((f) => f.status)).toEqual(["superseded", "confirmed"]);
    expect(out.changes[0]).toMatchObject({ field: "city", value: "杭州", previous: "上海" });
  });

  it("rejecting keeps the old value and drops the new fact", () => {
    const { profile, facts, conflict } = setup();
    const out = resolveConflict(profile, facts, conflict, false);
    expect(out.profile.basics.city).toBe("上海");
    expect(out.facts.map((f) => f.status)).toEqual(["confirmed", "superseded"]);
  });
});
