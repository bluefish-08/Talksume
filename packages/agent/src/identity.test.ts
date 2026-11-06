import { type Fact, Profile } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { computeCompleteness, pickNextSlot } from "./completeness.ts";
import { applyFacts, type Draft } from "./facts.ts";
import { isGenericName, isPlaceholder } from "./identity.ts";
import type { FactInput } from "./schemas.ts";
import { nextSlotOf, slotQuestion } from "./tools.ts";
import { createIntakeState } from "./types.ts";

let counter = 0;
const genId = (prefix: string) => `${prefix}_${++counter}`;
const project = (payload: Record<string, unknown>, quote: string) =>
  ({ section: "projects", payload, quote }) as FactInput;
const bare = project({ name: "Java 课程设计", techStack: ["Java"] }, "做过一个课程设计，Java 的");

/** 依次写入，带上暂存和已有事实，模拟多轮对话。 */
function converse(turns: FactInput[][], profile = Profile.parse({})) {
  let drafts: Draft[] = [];
  const facts: Fact[] = [];
  let last = applyFacts(profile, [], { messageId: "m0", genId });
  for (const [i, inputs] of turns.entries()) {
    last = applyFacts(last.profile, inputs, { messageId: `m${i + 1}`, genId, drafts, facts });
    drafts = last.drafts;
    facts.push(...last.facts);
  }
  return last;
}

describe("isGenericName", () => {
  it.each([
    ["Java 课程设计", true],
    ["课程设计（待补充名称）", true],
    ["数据结构课程设计", true],
    ["个人项目", true],
    ["管理系统", true],
    ["学生成绩管理系统", false],
    ["Java 课程设计：学生成绩管理系统", false],
    ["图书管理系统课程设计", false],
    ["MiniRedis", false],
  ])("projects %s → %s", (name, generic) => {
    expect(isGenericName("projects", name)).toBe(generic);
  });

  it.each([
    ["某公司", true],
    ["一家互联网公司", true],
    ["IBM", false],
    ["字节跳动", false],
  ])("experiences %s → %s", (name, generic) => {
    expect(isGenericName("experiences", name)).toBe(generic);
  });

  it("does not apply to skills or awards", () => {
    expect(isGenericName("skills", "Java")).toBe(false);
    expect(isGenericName("awards", "比赛")).toBe(false);
  });
});

describe("item identity", () => {
  it("keeps a bare generic mention as a placeholder draft, out of the resume", () => {
    const r = converse([[bare]]);
    expect(r.profile.projects).toEqual([]);
    expect(r.drafts).toHaveLength(1);
    expect(r.drafted).toEqual([expect.objectContaining({ label: "Java 课程设计", placeholder: true })]);
  });

  it("renames the placeholder when the name comes, and keeps it one item across later spellings", () => {
    const r = converse([
      [bare],
      [project({ name: "学生成绩管理系统", role: "与两名同学合作" }, "学生成绩管理系统，跟两个同学一起做的")],
      [project({ name: "Java 课程设计：学生成绩管理系统", techStack: ["MySQL"] }, "数据存在 MySQL 里")],
      [project({ name: "Java 课程设计", situation: "课程期末作业" }, "这是课程期末作业")],
    ]);
    expect(r.drafts).toEqual([]);
    expect(r.profile.projects).toHaveLength(1);
    expect(r.profile.projects[0]).toMatchObject({
      name: "Java 课程设计：学生成绩管理系统",
      techStack: ["Java", "MySQL"],
    });
    expect(r.profile.projects[0]?.sourceFactIds).toHaveLength(4);
  });

  it("renames the placeholder when the name is still generic but says more", () => {
    const r = converse([
      [project({ name: "课程设计" }, "做过课程设计")],
      [
        project(
          { name: "机械原理课程设计", situation: "简单的机构分析" },
          "机械原理课程设计，做的是个简单的机构分析",
        ),
      ],
      [project({ name: "机械原理课程设计", role: "独立完成" }, "我一个人做的")],
    ]);
    expect(r.drafts).toEqual([]);
    expect(r.profile.projects.map((p) => p.name)).toEqual(["机械原理课程设计"]);
  });

  it("adopts a legacy empty placeholder already in the profile", () => {
    const legacy = Profile.parse({
      projects: [{ id: "prj_old", sourceFactIds: [], name: "课程设计（待补充名称）" }],
    });
    const r = converse(
      [[project({ name: "图书管理系统", role: "独立完成" }, "做的是图书管理系统，我一个人做的")]],
      legacy,
    );
    expect(r.profile.projects).toEqual([expect.objectContaining({ id: "prj_old", name: "图书管理系统" })]);
    expect(r.changes).toContainEqual(
      expect.objectContaining({ itemId: "prj_old", field: "name", previous: "课程设计（待补充名称）" }),
    );
  });

  it("does not adopt a placeholder when the user is talking about another thing", () => {
    const r = converse([
      [bare],
      [project({ name: "个人博客网站", role: "独立开发" }, "我还自己做过一个个人博客网站")],
    ]);
    expect(r.profile.projects.map((p) => p.name)).toEqual(["个人博客网站"]);
    expect(r.drafts.map((d) => d.item.name)).toEqual(["Java 课程设计"]);
  });

  it("does not adopt a placeholder of a different kind of experience", () => {
    const r = converse([
      [project({ name: "毕业设计" }, "毕设做过")],
      [project({ name: "数学建模比赛：交通流量预测", role: "负责建模" }, "数学建模比赛做的是交通流量预测")],
    ]);
    expect(r.profile.projects.map((p) => p.name)).toEqual(["数学建模比赛：交通流量预测"]);
    expect(r.drafts.map((d) => d.item.name)).toEqual(["毕业设计"]);
  });

  it("keeps distinct specific names apart, including short contained names", () => {
    const r = converse([
      [project({ name: "图书管理系统", role: "后端" }, "图书管理系统，我做后端")],
      [project({ name: "学生成绩管理系统", role: "前端" }, "学生成绩管理系统，我做前端")],
      [project({ name: "商城", role: "测试" }, "商城项目我做测试")],
      [project({ name: "商城小程序", role: "前端" }, "商城小程序我做前端")],
    ]);
    expect(r.profile.projects.map((p) => p.name)).toEqual([
      "图书管理系统",
      "学生成绩管理系统",
      "商城",
      "商城小程序",
    ]);
  });

  it("does not merge skills by containment", () => {
    const r = converse([
      [{ section: "skills", payload: { name: "Java" }, quote: "会 Java" }],
      [{ section: "skills", payload: { name: "JavaScript" }, quote: "会 JavaScript" }],
    ]);
    expect(r.profile.skills.map((s) => s.name)).toEqual(["Java", "JavaScript"]);
  });

  it("drafts a named project with nothing else, and admits it once it has content", () => {
    const first = converse([[project({ name: "学生成绩管理系统" }, "学生成绩管理系统")]]);
    expect(first.profile.projects).toEqual([]);
    expect(first.drafted).toEqual([{ section: "projects", label: "学生成绩管理系统", missing: ["role"] }]);
    const done = converse([
      [project({ name: "学生成绩管理系统" }, "学生成绩管理系统")],
      [project({ name: "学生成绩管理系统", techStack: ["Java"] }, "用 Java 写的")],
    ]);
    expect(done.profile.projects).toEqual([expect.objectContaining({ name: "学生成绩管理系统" })]);
    expect(done.drafts).toEqual([]);
  });

  it("admits a generic name once the user has told what they did", () => {
    const r = converse([
      [
        project(
          { name: "课程设计", highlights: [{ title: "后端接口", detail: "负责后端接口" }] },
          "课程设计里我负责后端接口",
        ),
      ],
    ]);
    expect(r.profile.projects).toEqual([expect.objectContaining({ name: "课程设计" })]);
  });
});

describe("placeholders and the planner", () => {
  it("leaves legacy placeholder items out of completeness", () => {
    const legacy = Profile.parse({
      projects: [{ id: "prj_old", sourceFactIds: [], name: "课程设计（待补充名称）", techStack: ["Java"] }],
    });
    expect(isPlaceholder("projects", legacy.projects[0] as never)).toBe(true);
    const c = computeCompleteness(legacy);
    expect(c.missing.some((m) => m.itemId === "prj_old")).toBe(false);
    expect(c.score).toBe(computeCompleteness(Profile.parse({})).score);
    expect(pickNextSlot(legacy)?.itemId).toBeUndefined();
  });

  it("asks what a placeholder is, as an optional slot", () => {
    const state = createIntakeState();
    state.profile.basics = { name: "李明", phone: "13800001111", email: "a@b.com" } as never;
    state.drafts = converse([[bare]]).drafts;
    const slot = nextSlotOf(state);
    expect(slot).toMatchObject({ section: "projects", field: "name", required: false });
    expect(slot?.question).toContain("具体做的是什么");
  });

  it("still asks a real draft's required field as required", () => {
    const state = createIntakeState();
    state.drafts = converse([[project({ name: "学生成绩管理系统" }, "学生成绩管理系统")]]).drafts;
    const slot = nextSlotOf(state);
    expect(slot).toMatchObject({ field: "role", required: true });
    expect(slotQuestion(slot as never)).toBe(slot?.question);
  });
});
