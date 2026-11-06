import { type Fact, Profile } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { computeCompleteness, PROBES } from "./completeness.ts";
import {
  type Ledger,
  MEMORY_PROMPT_BUDGET,
  mergeLedgers,
  openingMessage,
  rebaseLedger,
  type SkipEntry,
  topicOfFacts,
} from "./memory.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { buildUserCorpus, createIntakeTools, nextSlotOf, type RunContext } from "./tools.ts";
import { createIntakeState, type IntakeState } from "./types.ts";

/** 除成绩外的字段都已齐全，其他分区已完成：下一个要问的就是成绩。 */
function gpaNextState(): IntakeState {
  return createIntakeState({
    profile: Profile.parse({
      basics: {
        name: "李明",
        phone: "13800000000",
        email: "liming@example.com",
        city: "江城",
        summary: "后端方向",
        links: [{ label: "GitHub", url: "github.com/example" }],
      },
      education: [
        {
          id: "edu_1",
          school: "示例大学",
          degree: "bachelor",
          major: "计算机",
          courses: ["数据结构"],
          start: "2021-09",
          end: "2025-06",
        },
      ],
    }),
    completedSections: ["experiences", "projects", "skills", "awards", "intention"],
    askCounts: Object.fromEntries(PROBES.map((p) => [`projects:_:${p.field}`, 2])),
  });
}

function toolsFor(state: IntakeState, texts: string[]) {
  const ctx: RunContext = {
    state,
    messageId: "m1",
    userCorpus: buildUserCorpus(texts),
    verifyQuote: true,
    genId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`,
    emit: () => {},
    flags: { asked: false, changed: false },
  };
  const tools = createIntakeTools(ctx);
  return async (name: string, args: unknown) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`${name} missing`);
    const result = await tool.execute("call_1", args as never);
    return result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  };
}

describe("问答账本", () => {
  it("合并老会话的数据：分区取并集，追问次数累加", () => {
    const merged = mergeLedgers([
      { completedSections: ["awards"], askCounts: { "basics:_:phone": 1 } },
      { completedSections: ["awards", "skills"], askCounts: { "basics:_:phone": 1, "basics:_:email": 2 } },
      {},
    ]);
    expect(merged.completedSections).toEqual(["awards", "skills"]);
    expect(merged.askCounts).toEqual({ "basics:_:phone": 2, "basics:_:email": 2 });
    expect(merged.skipped).toEqual([]);
  });

  it("把本会话的增量叠加到库里最新的账本上，不覆盖并行会话的写入", () => {
    const skip = (key: string): SkipEntry => ({
      key,
      section: "education",
      label: key,
      quote: "不想说",
      at: "2026-11-01T00:00:00.000Z",
    });
    const before: Ledger = { completedSections: ["awards"], askCounts: { a: 1 }, skipped: [skip("x")] };
    const after: Ledger = { completedSections: ["skills"], askCounts: { a: 2, b: 1 }, skipped: [skip("y")] };
    const current: Ledger = {
      completedSections: ["awards", "projects"],
      askCounts: { a: 3, c: 1 },
      skipped: [skip("x"), skip("z")],
    };
    const next = rebaseLedger(current, before, after);
    expect(next.completedSections).toEqual(["projects", "skills"]);
    expect(next.askCounts).toEqual({ a: 4, b: 1, c: 1 });
    expect(next.skipped.map((e) => e.key)).toEqual(["z", "y"]);
  });
});

describe("跳过的项", () => {
  it("skip_field 记下后不再被选中，原话和时间写进账本", async () => {
    const state = gpaNextState();
    expect(nextSlotOf(state)?.field).toBe("gpa");
    state.history.push({
      id: "a1",
      role: "assistant",
      content: "GPA 方便说一下吗？",
      meta: { slot: "education:edu_1:gpa" },
    });
    const call = toolsFor(state, ["成绩就不说了"]);
    const text = await call("skip_field", { quote: "成绩就不说了" });
    expect(text).toContain("以后不会再问");
    expect(state.skipped).toEqual([
      expect.objectContaining({
        key: "education:edu_1:gpa",
        section: "education",
        itemId: "edu_1",
        field: "gpa",
        quote: "成绩就不说了",
        label: "教育经历-示例大学-成绩/排名",
      }),
    ]);
    expect(Date.parse(state.skipped[0]?.at ?? "")).not.toBeNaN();
    expect(nextSlotOf(state)?.field).not.toBe("gpa");
  });

  it("即使追问次数清零，新会话也不会再选中已跳过的项", () => {
    const state = gpaNextState();
    state.skipped = [
      {
        key: "education:edu_1:gpa",
        section: "education",
        itemId: "edu_1",
        field: "gpa",
        label: "成绩",
        quote: "不想说",
        at: "2026-11-01T00:00:00.000Z",
      },
    ];
    expect(nextSlotOf(state)).toBeNull();
  });

  it("skip_field 校验原话和 key", async () => {
    const state = gpaNextState();
    state.history.push({
      id: "a1",
      role: "assistant",
      content: "GPA 方便说一下吗？",
      meta: { slot: "education:edu_1:gpa" },
    });
    const call = toolsFor(state, ["成绩就不说了"]);
    expect(await call("skip_field", { quote: "我没说过这句" })).toContain("不是用户说过的原话");
    expect(await call("skip_field", { key: "education:edu_1:school", quote: "成绩就不说了" })).toContain(
      "只能跳过上一轮问的那一项",
    );
    expect(await call("skip_field", { key: "nope", quote: "成绩就不说了" })).toContain(
      "只能跳过上一轮问的那一项",
    );
    expect(state.skipped).toEqual([]);
  });

  it("用户主动提起已跳过的字段：照常写入并解除跳过", async () => {
    const state = gpaNextState();
    const call = toolsFor(state, ["成绩就不说了", "想了想还是说吧，示例大学 GPA 3.6"]);
    await call("skip_field", { quote: "成绩就不说了" });
    await call("upsert_facts", {
      facts: [
        { section: "education", payload: { school: "示例大学", gpa: "3.6" }, quote: "示例大学 GPA 3.6" },
      ],
    });
    expect(state.profile.education[0]?.gpa).toBe("3.6");
    expect(state.skipped).toEqual([]);
  });

  it("整区跳过后用户又提起：解除跳过并撤销完成标记", async () => {
    const state = createIntakeState();
    const call = toolsFor(state, ["没拿过什么奖", "哦对，拿过校级一等奖学金"]);
    await call("complete_section", { section: "awards", reason: "user_skipped", quote: "没拿过什么奖" });
    expect(state.completedSections).toContain("awards");
    expect(state.skipped.map((e) => e.key)).toEqual(["awards:*"]);
    await call("upsert_facts", {
      facts: [{ section: "awards", payload: { name: "校级一等奖学金" }, quote: "拿过校级一等奖学金" }],
    });
    expect(state.skipped).toEqual([]);
    expect(state.completedSections).not.toContain("awards");
    expect(state.profile.awards).toHaveLength(1);
  });
});

describe("开场白", () => {
  it("画像为空时首次见面，问称呼", () => {
    const state = createIntakeState();
    const text = openingMessage({ profile: state.profile, slot: nextSlotOf(state) });
    expect(text).toContain("你好，我是简聊助手");
    expect(text).toContain("怎么称呼你");
  });

  it("已有姓名时接续上次的话题，不再问称呼", () => {
    const state = createIntakeState({ profile: Profile.parse({ basics: { name: "李明" } }) });
    const slot = nextSlotOf(state);
    const text = openingMessage({ profile: state.profile, slot, topic: "项目经历里的「江城闲置」" });
    expect(text).not.toContain("称呼");
    expect(text).toMatch(/^欢迎回来，李明。上次聊到项目经历里的「江城闲置」，/);
    expect(text).toContain(slot?.question ?? "");
  });

  it("没有要问的了就问这次想补什么", () => {
    const text = openingMessage({ profile: gpaNextState().profile, slot: null, topic: "江城闲置项目" });
    expect(text).toBe("欢迎回来，李明。上次聊到江城闲置项目，这次想补点什么？");
  });

  it("话头取画像里最近写入的非基本信息条目", () => {
    const fact = (
      section: Fact["section"],
      payload: Record<string, unknown>,
      status: Fact["status"] = "confirmed",
    ) => ({ id: `f_${section}`, section, payload, quote: "", sourceMessageId: "", status }) as Fact;
    expect(
      topicOfFacts([
        fact("projects", { name: "江城闲置" }),
        fact("basics", { phone: "13800000000" }),
        fact("skills", { name: "Rust" }, "superseded"),
      ]),
    ).toBe("项目经历里的「江城闲置」");
    expect(topicOfFacts([fact("basics", { name: "李明" })])).toBeUndefined();
  });
});

describe("system prompt 里的跨会话记忆", () => {
  const promptOf = (state: IntakeState) =>
    buildSystemPrompt({
      profile: state.profile,
      completeness: computeCompleteness(state.profile, { completedSections: state.completedSections }),
      slot: nextSlotOf(state),
      completedSections: state.completedSections,
      conflicts: [],
      skipped: state.skipped,
      summaries: state.summaries ?? [],
    });

  it("包含已跳过项和最近 3 条摘要", () => {
    const state = gpaNextState();
    state.skipped = [
      {
        key: "education:edu_1:gpa",
        section: "education",
        field: "gpa",
        label: "教育经历-示例大学-成绩/排名",
        quote: "成绩就不说了",
        at: "2026-11-01T00:00:00.000Z",
      },
    ];
    state.summaries = [1, 2, 3, 4].map((i) => ({
      summary: `第${i}次：聊了江城闲置项目，说回头补实习`,
      createdAt: new Date(Date.UTC(2026, 9, 30 - i)),
    }));
    const prompt = promptOf(state);
    expect(prompt).toContain("已跳过 / 已确认没有");
    expect(prompt).toContain("- 教育经历-示例大学-成绩/排名（原话「成绩就不说了」）");
    expect(prompt).toContain("第3次");
    expect(prompt).not.toContain("第4次");
  });

  it("记忆部分不超过长度上限", () => {
    const state = createIntakeState();
    state.skipped = Array.from({ length: 80 }, (_, i) => ({
      key: `projects:p${i}:result_quantified`,
      section: "projects" as const,
      label: `项目经历-示例项目${i}-结果的量化数据`,
      quote: "这个真没有数据可以说的了".repeat(3),
      at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    }));
    state.summaries = [{ summary: "长".repeat(400), createdAt: new Date() }];
    const prompt = promptOf(state);
    const start = prompt.indexOf("## 已跳过");
    const end = prompt.indexOf("## 当前目标字段");
    expect(start).toBeGreaterThan(0);
    expect(end - start).toBeLessThanOrEqual(MEMORY_PROMPT_BUDGET);
    expect(prompt).toContain("示例项目79");
    expect(prompt).not.toContain("示例项目0-");
    expect(prompt).toContain(`：${"长".repeat(150)}\n`);
  });
});
