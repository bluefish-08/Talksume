import {
  createFauxCore,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type JsonObject,
} from "@earendil-works/pi-ai";
import { Profile } from "@talksume/core";
import { createGateway, loadGatewayConfig } from "@talksume/llm-gateway";
import { describe, expect, it } from "vitest";
import { createIntakeController, replayRecord, type TurnMetrics } from "./controller.ts";
import { cleanQuickReplies, toolJsonSchema, UpsertFactsArgs } from "./schemas.ts";
import type { IntakeEvent } from "./types.ts";
import { createIntakeState } from "./types.ts";

let n = 0;
const genId = (prefix: string) => `${prefix}_${++n}`;

function fake(steps: FauxResponseStep[], prompts: string[] = []) {
  const core = createFauxCore({ models: [{ id: "fake-model" }] });
  core.setResponses(steps);
  const controller = createIntakeController({
    streamFn: (model, context, options) => {
      const first = context.messages[0];
      if (first?.role === "system") prompts.push(JSON.stringify(first.content));
      return core.streamSimple(model, context, options);
    },
    model: core.getModel(),
    genId,
  });
  return { core, controller };
}

async function collect(gen: AsyncGenerator<IntakeEvent, void>): Promise<IntakeEvent[]> {
  const events: IntakeEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

const toolTurn = (...calls: ReturnType<typeof fauxToolCall>[]) =>
  fauxAssistantMessage(calls, { stopReason: "toolUse" });
const upsert = (facts: JsonObject[]) => fauxToolCall("upsert_facts", { facts });
const ask = (question: string) => fauxToolCall("ask_user", { question });

const types = (events: IntakeEvent[]) => events.map((e) => e.type);
const tokens = (events: IntakeEvent[]) =>
  events.flatMap((e) => (e.type === "token" ? [e.text] : [])).join("");
const asks = (events: IntakeEvent[]) => events.flatMap((e) => (e.type === "ask" ? [e] : []));
const completenessOf = (events: IntakeEvent[]) => {
  const last = events.at(-1);
  if (last?.type !== "completeness") throw new Error("completeness must be the last event");
  return last.completeness.score;
};

describe("intake controller: three-turn conversation", () => {
  it("collects facts across turns, streams events and injects the current target into the prompt", async () => {
    const prompts: string[] = [];
    const { controller } = fake(
      [
        toolTurn(
          upsert([
            {
              section: "basics",
              payload: { name: "李明", phone: "13800001111" },
              quote: "我叫李明，手机 13800001111",
            },
            {
              section: "education",
              payload: { school: "上海交通大学", degree: "bachelor", major: "计算机" },
              quote: "在上海交通大学读计算机本科",
            },
          ]),
        ),
        toolTurn(ask("你的常用邮箱是什么？")),
        toolTurn(
          upsert([
            { section: "basics", payload: { email: "liming@example.com" }, quote: "邮箱 liming@example.com" },
            {
              section: "intention",
              payload: { roles: ["后端开发"], cities: ["杭州"], jobType: "internship" },
              quote: "我想找杭州的后端实习",
            },
          ]),
        ),
        toolTurn(ask("有没有做过拿得出手的项目？")),
        toolTurn(
          upsert([
            {
              section: "projects",
              payload: {
                name: "短链服务",
                role: "核心服务负责人",
                techStack: ["Go", "Redis"],
                action: "设计了分片和缓存",
                result: "QPS 从 200 提升到 3000",
              },
              quote: "做过一个短链服务，用 Go 和 Redis，我负责核心服务，QPS 从 200 提升到 3000",
            },
          ]),
        ),
        toolTurn(ask("还会哪些技能？")),
      ],
      prompts,
    );
    const state = createIntakeState();
    const scores: number[] = [];

    const e1 = await collect(
      controller.handleUserMessage(state, {
        id: "m1",
        text: "我叫李明，手机 13800001111，在上海交通大学读计算机本科",
      }),
    );
    scores.push(completenessOf(e1));
    expect(types(e1)).toEqual(["profile_patch", "ask", "completeness"]);
    expect(asks(e1)[0]).toMatchObject({ kind: "followup", question: "你的常用邮箱是什么？" });
    expect(state.profile.education[0]?.degree).toBe("bachelor");
    expect(state.profile.education[0]?.sourceFactIds).toHaveLength(1);

    const e2 = await collect(
      controller.handleUserMessage(state, {
        id: "m2",
        text: "邮箱 liming@example.com，我想找杭州的后端实习",
      }),
    );
    scores.push(completenessOf(e2));
    expect(state.profile.basics.email).toBe("liming@example.com");
    expect(state.profile.intention).toMatchObject({
      roles: ["后端开发"],
      cities: ["杭州"],
      jobType: "internship",
    });

    const e3 = await collect(
      controller.handleUserMessage(state, {
        id: "m3",
        text: "做过一个短链服务，用 Go 和 Redis，我负责核心服务，QPS 从 200 提升到 3000",
      }),
    );
    scores.push(completenessOf(e3));
    expect(state.profile.projects[0]).toMatchObject({ name: "短链服务", techStack: ["Go", "Redis"] });
    expect(state.profile.projects[0]?.sourceFactIds).toHaveLength(1);
    const patch = e3.find((e) => e.type === "profile_patch");
    expect(patch && "changes" in patch ? patch.changes.some((c) => c.section === "projects") : false).toBe(
      true,
    );

    expect(scores[0]).toBeLessThan(scores[1] as number);
    expect(scores[1]).toBeLessThan(scores[2] as number);
    expect(state.facts.every((f) => f.status === "confirmed")).toBe(true);
    expect(state.facts.map((f) => f.sourceMessageId)).toContain("m3");
    expect(state.history.map((h) => h.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);

    expect(prompts[0]).toContain("当前目标字段");
    expect(prompts[0]).toContain("basics:_:name");
    expect(prompts[0]).toContain("参考问法");
    expect(prompts.find((p) => p.includes("上海交通大学") && p.includes("当前目标字段"))).toBeDefined();
    expect(prompts.at(-1)).toContain("liming@example.com");
  });

  it("streams assistant text as token events", async () => {
    const { controller } = fake([
      fauxAssistantMessage(
        [
          fauxText("你好李明！"),
          upsert([{ section: "basics", payload: { name: "李明" }, quote: "我叫李明" }]),
        ],
        {
          stopReason: "toolUse",
        },
      ),
      toolTurn(ask("方便留个手机号吗？")),
    ]);
    const events = await collect(
      controller.handleUserMessage(createIntakeState(), { id: "m1", text: "我叫李明" }),
    );
    const tokenText = events.flatMap((e) => (e.type === "token" ? [e.text] : [])).join("");
    expect(tokenText).toBe("你好李明！");
  });
});

describe("intake controller: tool argument validation", () => {
  it("lets the model fix invalid arguments once", async () => {
    const { controller, core } = fake([
      toolTurn(
        upsert([
          {
            section: "education",
            payload: { school: "清华大学", degree: "本科", major: "物理" },
            quote: "清华大学本科物理",
          },
        ]),
      ),
      toolTurn(
        upsert([
          {
            section: "education",
            payload: { school: "清华大学", degree: "bachelor", major: "物理" },
            quote: "清华大学本科物理",
          },
        ]),
      ),
      toolTurn(ask("你是哪一年入学的？")),
    ]);
    const state = createIntakeState();
    const events = await collect(
      controller.handleUserMessage(state, { id: "m1", text: "我在清华大学本科物理" }),
    );
    expect(state.profile.education[0]?.degree).toBe("bachelor");
    expect(asks(events).map((a) => a.kind)).toEqual(["followup"]);
    expect(core.state.callCount).toBe(3);
  });

  it("turns a second failure into a clarification question instead of looping", async () => {
    const bad = upsert([
      { section: "education", payload: { school: "清华大学", degree: "本科" }, quote: "清华大学本科" },
    ]);
    const { controller, core } = fake([toolTurn(bad), toolTurn(bad), toolTurn(ask("不应被执行"))]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "我在清华大学本科" }));
    expect(state.profile.education).toHaveLength(0);
    const [question] = asks(events);
    expect(question).toMatchObject({ kind: "clarify" });
    expect(question?.question).toContain("清华大学本科");
    expect(core.state.callCount).toBe(2);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(completenessOf(events)).toBe(0);
  });

  it("rejects quotes that are not verbatim user words and lets the model correct them", async () => {
    const { controller } = fake([
      toolTurn(upsert([{ section: "basics", payload: { name: "李明" }, quote: "他叫李明，是个好学生" }])),
      toolTurn(upsert([{ section: "basics", payload: { name: "李明" }, quote: "我叫李明" }])),
      toolTurn(ask("手机号是多少？")),
    ]);
    const state = createIntakeState();
    await collect(controller.handleUserMessage(state, { id: "m1", text: "我叫李明" }));
    expect(state.profile.basics.name).toBe("李明");
    expect(state.facts[0]?.quote).toBe("我叫李明");
  });

  it("drafts a new item with missing required fields and targets the missing field next", async () => {
    const { controller, core } = fake([
      toolTurn(upsert([{ section: "education", payload: { school: "清华大学" }, quote: "清华大学" }])),
      toolTurn(ask("读的是本科还是研究生？")),
    ]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "我是清华大学的" }));
    expect(state.profile.education).toHaveLength(0);
    expect(state.drafts).toEqual([expect.objectContaining({ section: "education" })]);
    expect(asks(events)[0]).toMatchObject({
      kind: "followup",
      slot: { section: "education", field: "degree" },
    });
    expect(core.state.callCount).toBe(2);
  });
});

describe("intake controller: contradictions, fallbacks and errors", () => {
  it("raises a confirmation instead of silently overwriting, then resolves it", async () => {
    const state = createIntakeState();
    const first = fake([
      toolTurn(upsert([{ section: "basics", payload: { city: "上海" }, quote: "我在上海" }])),
      toolTurn(ask("你叫什么？")),
    ]);
    await collect(first.controller.handleUserMessage(state, { id: "m1", text: "我在上海" }));

    const second = fake([
      toolTurn(upsert([{ section: "basics", payload: { city: "杭州" }, quote: "我在杭州" }])),
      toolTurn(ask("不应出现的追问")),
    ]);
    const events = await collect(
      second.controller.handleUserMessage(state, { id: "m2", text: "其实我在杭州" }),
    );
    expect(state.profile.basics.city).toBe("上海");
    const confirm = asks(events);
    expect(confirm).toHaveLength(1);
    expect(confirm[0]).toMatchObject({
      kind: "confirm",
      conflict: { field: "city", previous: "上海", proposed: "杭州" },
    });
    expect(confirm[0]?.question).toContain("上海");
    expect(state.conflicts).toHaveLength(1);

    const factId = state.conflicts[0]?.factId ?? "";
    const resolved = second.controller.confirmConflict(state, factId, true);
    expect(state.profile.basics.city).toBe("杭州");
    expect(state.conflicts).toHaveLength(0);
    expect(resolved.map((e) => e.type)).toEqual(["profile_patch", "completeness"]);
  });

  it("falls back to the next slot's question when the model forgets to ask", async () => {
    const { controller } = fake([
      toolTurn(upsert([{ section: "basics", payload: { name: "李明" }, quote: "我叫李明" }])),
      fauxAssistantMessage("好的，记下了。"),
    ]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "我叫李明" }));
    const [fallback] = asks(events);
    expect(fallback).toMatchObject({ kind: "followup", slot: { section: "basics", field: "phone" } });
    expect(state.askCounts["basics:_:phone"]).toBe(1);
    expect(state.history.at(-1)?.content).toContain("好的，记下了。");
    expect(state.history.at(-1)?.content).toContain(fallback?.question ?? "?");
  });

  it("does not tack the slot question onto a reply that already asks something mid-text", async () => {
    const { controller } = fake([fauxAssistantMessage("这段时间有没有做过项目？比如课程设计都算。")]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "专科的" }));
    expect(asks(events)).toEqual([]);
    expect(state.history.at(-1)?.content).toBe("这段时间有没有做过项目？比如课程设计都算。");
  });

  it("uses the model's text as the reply and marks the ask_user question as already in it", async () => {
    const { controller } = fake([
      fauxAssistantMessage(
        [fauxText("好的，李明～方便留一个手机号吗？投递简历时 HR 会用到。"), ask("方便留一个手机号吗？")],
        { stopReason: "toolUse" },
      ),
    ]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "李明" }));
    expect(asks(events)).toEqual([expect.objectContaining({ inText: true })]);
    expect(state.history.at(-1)?.content).toBe("好的，李明～方便留一个手机号吗？投递简历时 HR 会用到。");
  });

  it("falls back to the ask_user question when the model writes no text", async () => {
    const { controller } = fake([toolTurn(ask("方便留一个手机号吗？"))]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "李明" }));
    expect(asks(events)[0]?.inText).toBeUndefined();
    expect(state.history.at(-1)?.content).toBe("方便留一个手机号吗？");
  });

  it("appends the ask_user question when the text only acknowledges", async () => {
    const { controller } = fake([
      fauxAssistantMessage([fauxText("你好李明！"), ask("方便留一个手机号吗？")], { stopReason: "toolUse" }),
    ]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "李明" }));
    expect(asks(events)[0]?.inText).toBeUndefined();
    expect(state.history.at(-1)?.content).toBe("你好李明！\n方便留一个手机号吗？");
  });

  it("keeps the reply without an error when the stream breaks after the question was already said", async () => {
    const { controller } = fake([
      toolTurn(
        upsert([{ section: "intention", payload: { roles: ["全栈工程师"] }, quote: "我想找全栈工程师" }]),
      ),
      fauxAssistantMessage([fauxText("记下了。先认识一下，怎么称呼你？")], {
        stopReason: "error",
        errorMessage: "[llm:timeout] 响应中断（20000ms 无数据）",
      }),
    ]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "我想找全栈工程师" }));
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(state.history.at(-1)?.content).toBe("记下了。先认识一下，怎么称呼你？");
    expect(state.profile.intention.roles).toEqual(["全栈工程师"]);
  });

  it("正文说到一半断流时，扣下的半句丢掉，让模型接着往下说并补上写入", async () => {
    const quote = "和两个同学一起做了个学生成绩管理系统";
    const { controller } = fake([
      fauxAssistantMessage([fauxText("这个项目挺实在的。我把这些")], {
        stopReason: "error",
        errorMessage: "[llm:timeout] 响应中断（20000ms 无数据）",
      }),
      (context) => {
        const note = JSON.stringify(context.messages.at(-1));
        expect(note).toContain("用户只看到了「这个项目挺实在的。」");
        expect(note).not.toContain("我把这些");
        return fauxAssistantMessage(
          [
            fauxText("做的时候遇到过什么难点？"),
            upsert([{ section: "projects", payload: { name: "学生成绩管理系统" }, quote }]),
            ask("做的时候遇到过什么难点？"),
          ],
          { stopReason: "toolUse" },
        );
      },
    ]);
    const state = createIntakeState();
    const events = await collect(
      controller.handleUserMessage(state, { id: "m1", text: `Java 课设，${quote}，我负责成绩录入` }),
    );
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(state.profile.projects.map((p) => p.name)).toEqual(["学生成绩管理系统"]);
    expect(state.history.at(-1)?.content).toBe("这个项目挺实在的。做的时候遇到过什么难点？");
    expect(tokens(events)).toBe("这个项目挺实在的。做的时候遇到过什么难点？");
  });

  it("接着说也断了时报错，存下的回复去掉末尾半句", async () => {
    const broken = (text: string) =>
      fauxAssistantMessage(text ? [fauxText(text)] : [], {
        stopReason: "error",
        errorMessage: "[llm:timeout] 响应中断（20000ms 无数据）",
      });
    const { core, controller } = fake([
      toolTurn(
        upsert([{ section: "intention", payload: { roles: ["Java 开发"] }, quote: "想找 Java 开发" }]),
      ),
      broken("目标很清晰。回到那个项目：做的过程中有遇到什么卡"),
      broken(""),
    ]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "想找 Java 开发" }));
    expect(core.state.callCount).toBe(3);
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "timeout", recoverable: true });
    expect(state.profile.intention.roles).toEqual(["Java 开发"]);
    expect(state.history.at(-1)?.content).toBe("目标很清晰。");
    expect(tokens(events)).toBe("目标很清晰。");
  });

  it("reports an unrecoverable quota error from the gateway without touching history", async () => {
    const core = createFauxCore({ models: [{ id: "deepseek-v4.1-flash" }, { id: "glm-5.3" }] });
    core.setResponses(
      Array.from({ length: 5 }, () =>
        fauxAssistantMessage([], {
          stopReason: "error",
          errorMessage: '429 {"code":"API_KEY_TOKEN_BUDGET_EXCEEDED"}',
        }),
      ),
    );
    const gateway = createGateway(loadGatewayConfig({ LLM_BASE_URL: "http://x/v1", LLM_API_KEY: "k" }), {
      baseStream: (m, c, o) => core.streamSimple(m, c, o),
    });
    const controller = createIntakeController({
      streamFn: gateway.streamFn("intake"),
      model: gateway.primaryModel,
      genId,
    });
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "你好" }));
    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "quota_exhausted",
      recoverable: false,
    });
    expect(asks(events)).toHaveLength(0);
    expect(state.history).toHaveLength(0);
    expect(core.state.callCount).toBe(1);
  });

  it("rejects complete_section when required fields are missing, and accepts a quoted skip", async () => {
    const { controller } = fake([
      toolTurn(fauxToolCall("complete_section", { section: "education" })),
      toolTurn(
        fauxToolCall("complete_section", { section: "awards", reason: "user_skipped", quote: "没有获过奖" }),
      ),
      toolTurn(ask("你想找什么岗位？")),
    ]);
    const state = createIntakeState();
    await collect(controller.handleUserMessage(state, { id: "m1", text: "我没有获过奖" }));
    expect(state.completedSections).toEqual(["awards"]);
  });

  it("does not mutate state when the caller aborts", async () => {
    const { controller } = fake([toolTurn(ask("问题"))]);
    const abort = new AbortController();
    abort.abort();
    const state = createIntakeState();
    const events = await collect(
      controller.handleUserMessage(state, { id: "m1", text: "hi" }, { signal: abort.signal }),
    );
    expect(events.some((e) => e.type === "ask" && e.kind === "confirm")).toBe(false);
    expect(state.history).toHaveLength(0);
  });
});

describe("intake controller: resolving a conflict continues the conversation", () => {
  async function conflicted(afterResolve: FauxResponseStep[], prompts: string[] = []) {
    const state = createIntakeState();
    const first = fake([
      toolTurn(upsert([{ section: "basics", payload: { name: "林晓" }, quote: "我叫林晓" }])),
      toolTurn(ask("手机号是多少？")),
    ]);
    await collect(first.controller.handleUserMessage(state, { id: "m1", text: "我叫林晓" }));
    const second = fake(
      [
        toolTurn(upsert([{ section: "basics", payload: { name: "陈晓" }, quote: "不对，我叫陈晓" }])),
        ...afterResolve,
      ],
      prompts,
    );
    await collect(second.controller.handleUserMessage(state, { id: "m2", text: "不对，我叫陈晓" }));
    return { state, controller: second.controller, core: second.core };
  }

  it("adopting the new value streams the next question in the same turn", async () => {
    const { state, controller } = await conflicted([
      toolTurn(
        fauxToolCall("ask_user", { question: "手机号是多少？", quickReplies: ["138 开头", "不想留"] }),
      ),
    ]);
    const factId = state.conflicts[0]?.factId ?? "";
    const events = await collect(controller.resolveConflict(state, factId, true));

    expect(types(events)).toEqual(["profile_patch", "ask", "completeness"]);
    expect(state.profile.basics.name).toBe("陈晓");
    expect(state.conflicts).toHaveLength(0);
    expect(asks(events)[0]).toMatchObject({
      kind: "followup",
      question: "手机号是多少？",
      quickReplies: ["138 开头", "不想留"],
    });
    const reply = state.history.at(-1);
    expect(reply).toMatchObject({ role: "assistant", content: "手机号是多少？" });
    expect(reply?.meta?.changes).toMatchObject([{ field: "name", value: "陈晓", previous: "林晓" }]);
    expect(reply?.meta?.quickReplies).toEqual(["138 开头", "不想留"]);
  });

  it("keeping the old value also continues, and the synthetic notice is not stored as a user turn", async () => {
    const { state, controller } = await conflicted([fauxAssistantMessage("好的，保留林晓。")]);
    const factId = state.conflicts[0]?.factId ?? "";
    const before = state.history.filter((t) => t.role === "user").length;
    const events = await collect(controller.resolveConflict(state, factId, false));

    expect(state.profile.basics.name).toBe("林晓");
    expect(asks(events)[0]).toMatchObject({ kind: "followup", slot: { field: "phone" } });
    expect(events.some((e) => e.type === "token")).toBe(true);
    expect(state.history.filter((t) => t.role === "user")).toHaveLength(before);
  });

  it("does not call the model while other conflicts are still pending", async () => {
    const { state, controller, core } = await conflicted([]);
    state.conflicts.push({ ...(state.conflicts[0] as (typeof state.conflicts)[number]), factId: "other" });
    const callsBefore = core.state.callCount;
    const events = await collect(controller.resolveConflict(state, state.conflicts[0]?.factId ?? "", true));
    expect(core.state.callCount).toBe(callsBefore);
    expect(types(events)).toEqual(["profile_patch", "ask", "completeness"]);
    expect(asks(events)[0]?.kind).toBe("confirm");
    expect(state.history.at(-1)?.meta?.changes).toHaveLength(1);
  });

  it("still records the change row when the model fails", async () => {
    const { state, controller } = await conflicted([
      fauxAssistantMessage([], { stopReason: "error", errorMessage: "boom" }),
    ]);
    const factId = state.conflicts[0]?.factId ?? "";
    const events = await collect(controller.resolveConflict(state, factId, true));
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(state.history.at(-1)?.meta?.changes).toHaveLength(1);
  });

  it("skips the model when continueTurn is false", async () => {
    const { state, controller, core } = await conflicted([]);
    const callsBefore = core.state.callCount;
    const events = await collect(
      controller.resolveConflict(state, state.conflicts[0]?.factId ?? "", true, { continueTurn: false }),
    );
    expect(core.state.callCount).toBe(callsBefore);
    expect(types(events)).toEqual(["profile_patch", "completeness"]);
  });
});

describe("intake controller: answering a conflict in words", () => {
  const SECTION = "待用户确认的矛盾";

  async function conflicted(steps: FauxResponseStep[], prompts: string[]) {
    const state = createIntakeState();
    const { controller, core } = fake(
      [
        toolTurn(upsert([{ section: "basics", payload: { city: "武汉" }, quote: "我在武汉" }])),
        toolTurn(ask("你叫什么？")),
        toolTurn(upsert([{ section: "basics", payload: { city: "杭州" }, quote: "我在杭州" }])),
        ...steps,
      ],
      prompts,
    );
    await collect(controller.handleUserMessage(state, { id: "m1", text: "我在武汉" }));
    await collect(controller.handleUserMessage(state, { id: "m2", text: "我在杭州" }));
    return { state, controller, core };
  }

  it("resolves the conflict when the user types 用原来的, and drops it from the next prompt", async () => {
    const prompts: string[] = [];
    const { state, controller } = await conflicted(
      [
        toolTurn(
          fauxToolCall("resolve_conflict", { field: "city", choice: "previous", quote: "可以用原来的" }),
        ),
        toolTurn(ask("你叫什么？")),
        toolTurn(upsert([{ section: "basics", payload: { name: "李明" }, quote: "我叫李明" }])),
        toolTurn(ask("手机号是多少？")),
      ],
      prompts,
    );
    expect(state.conflicts).toHaveLength(1);
    const factId = state.conflicts[0]?.factId ?? "";

    const events = await collect(controller.handleUserMessage(state, { id: "m3", text: "可以用原来的" }));
    expect(prompts.at(-1)).toContain(SECTION);
    expect(prompts.at(-1)).toContain(`factId=${factId}`);
    expect(state.conflicts).toHaveLength(0);
    expect(state.profile.basics.city).toBe("武汉");
    expect(state.facts.find((f) => f.id === factId)?.status).toBe("superseded");
    expect(asks(events)).toMatchObject([{ kind: "followup", question: "你叫什么？" }]);
    expect(events.filter((e) => e.type === "completeness").length).toBeGreaterThan(0);

    await collect(controller.handleUserMessage(state, { id: "m4", text: "我叫李明" }));
    expect(prompts.at(-1)).not.toContain(SECTION);
    expect(state.profile.basics).toMatchObject({ name: "李明", city: "武汉" });
  });

  it("adopts the new value by factId and patches the profile", async () => {
    const { state } = await conflicted([], []);
    const factId = state.conflicts[0]?.factId ?? "";
    const { controller: next } = fake([
      toolTurn(fauxToolCall("resolve_conflict", { factId, choice: "proposed", quote: "新的对" })),
      toolTurn(ask("你叫什么？")),
    ]);
    const events = await collect(next.handleUserMessage(state, { id: "m3", text: "新的对" }));
    expect(state.conflicts).toHaveLength(0);
    expect(state.profile.basics.city).toBe("杭州");
    expect(events.find((e) => e.type === "profile_patch")).toMatchObject({
      changes: [{ field: "city", value: "杭州", previous: "武汉" }],
    });
    expect(state.history.at(-1)?.meta?.changes).toHaveLength(1);
  });

  it("rejects a quote the user never said and keeps the conflict", async () => {
    const { state, controller } = await conflicted(
      [
        toolTurn(fauxToolCall("resolve_conflict", { field: "city", choice: "previous", quote: "保留武汉" })),
        toolTurn(ask("你叫什么？")),
      ],
      [],
    );
    await collect(controller.handleUserMessage(state, { id: "m3", text: "用之前那个吧" }));
    expect(state.conflicts).toHaveLength(1);
    expect(state.profile.basics.city).toBe("武汉");
  });

  it("lets an unrelated answer through and leaves the conflict pending", async () => {
    const { state, controller } = await conflicted(
      [
        toolTurn(upsert([{ section: "basics", payload: { name: "李明" }, quote: "我叫李明" }])),
        toolTurn(ask("手机号是多少？")),
      ],
      [],
    );
    const events = await collect(controller.handleUserMessage(state, { id: "m3", text: "我叫李明" }));
    expect(state.profile.basics.name).toBe("李明");
    expect(state.conflicts).toHaveLength(1);
    expect(asks(events)).toMatchObject([{ kind: "followup", question: "手机号是多少？" }]);
  });
});

describe("intake controller: adding to a narrative field", () => {
  it("appends a project action supplement and does not re-raise a conflict on a restatement", async () => {
    const action = "负责后端，做了商品发布、搜索和订单模块，用 Redis 缓存热门商品";
    const supplement = "通过加索引、SQL 优化和 Redis 缓存优化接口性能";
    const { controller } = fake([
      toolTurn(upsert([{ section: "projects", payload: { name: "江城闲置", action }, quote: action }])),
      toolTurn(ask("项目最后效果怎么样？")),
      toolTurn(
        upsert([
          {
            section: "projects",
            payload: { name: "江城闲置", action: supplement },
            quote: "加了索引 sql 优化和 redis",
          },
        ]),
      ),
      toolTurn(ask("项目最后效果怎么样？")),
      toolTurn(
        upsert([
          {
            section: "projects",
            payload: {
              name: "江城闲置",
              action: "负责后端的商品发布、搜索和订单模块，加索引、SQL 优化，Redis 缓存",
            },
            quote: "加了索引 sql 优化和 redis",
          },
        ]),
      ),
      toolTurn(ask("项目最后效果怎么样？")),
    ]);
    const state = createIntakeState();
    await collect(controller.handleUserMessage(state, { id: "m1", text: action }));

    const added = await collect(
      controller.handleUserMessage(state, { id: "m2", text: "加了索引 sql 优化和 redis" }),
    );
    expect(asks(added).map((a) => a.kind)).toEqual(["followup"]);
    expect(state.conflicts).toHaveLength(0);
    expect(state.profile.projects[0]?.action).toBe(`${action}；${supplement}`);

    const asked = await collect(controller.handleUserMessage(state, { id: "m3", text: "冲突吗？" }));
    expect(asks(asked).map((a) => a.kind)).toEqual(["followup"]);
    expect(state.conflicts).toHaveLength(0);
    expect(state.profile.projects[0]?.action).toBe(`${action}；${supplement}`);
  });

  it("asks for full merged narrative text and forbids promising actions without tools", async () => {
    const prompts: string[] = [];
    const { controller } = fake([toolTurn(ask("你叫什么？"))], prompts);
    await collect(controller.handleUserMessage(createIntakeState(), { id: "m1", text: "你好" }));
    expect(prompts[0]).toContain("完整合并文本");
    expect(prompts[0]).toContain("不要承诺任何没有工具支持的动作");
    expect(prompts[0]).toContain("右侧预览就是简历，可以点「润色」优化表述、切换模板，或者直接导出");
    expect(prompts[0]).not.toContain("可以去生成简历");
  });
});

describe("intake controller: quick replies", () => {
  it("passes quickReplies of ask_user through and stores them on the assistant turn", async () => {
    const { controller } = fake([
      toolTurn(
        fauxToolCall("ask_user", {
          question: "这个项目是独立完成的吗？",
          quickReplies: ["是独立完成的", "和同学合作，我负责存储层", "跳过这个"],
        }),
      ),
    ]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "你好" }));
    expect(asks(events)[0]?.quickReplies).toEqual(["是独立完成的", "和同学合作，我负责存储层", "跳过这个"]);
    expect(state.history.at(-1)?.meta?.quickReplies).toHaveLength(3);
  });

  it("shows nothing when the model gives none", async () => {
    const { controller } = fake([toolTurn(ask("你叫什么？"))]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "你好" }));
    expect(asks(events)[0]).not.toHaveProperty("quickReplies");
    expect(state.history.at(-1)?.meta).toEqual({ slot: "basics:_:name" });
  });

  it("cleans dirty lists: dedupes, drops blanks and overlong items, caps at 4, needs at least 2", () => {
    expect(cleanQuickReplies(["a", " a ", "", "b", "c", "d", "e"])).toEqual(["a", "b", "c", "d"]);
    expect(cleanQuickReplies(["只有一条"])).toEqual([]);
    expect(cleanQuickReplies(["x".repeat(40), "ok"])).toEqual([]);
    expect(cleanQuickReplies(undefined)).toEqual([]);
  });
});

describe("intake controller: skill levels", () => {
  it("keeps 熟悉 as familiar and leaves the level empty when the user gave none", async () => {
    const { controller } = fake([
      toolTurn(
        upsert([
          {
            section: "skills",
            payload: { name: "Go", level: "familiar" },
            quote: "技能上熟悉 Go、MySQL、Redis、Kafka",
          },
          { section: "skills", payload: { name: "Python" }, quote: "也写过 Python" },
        ]),
      ),
      toolTurn(ask("还有别的技能吗？")),
    ]);
    const state = createIntakeState();
    await collect(
      controller.handleUserMessage(state, {
        id: "m1",
        text: "技能上熟悉 Go、MySQL、Redis、Kafka，也写过 Python",
      }),
    );
    expect(state.profile.skills.find((s) => s.name === "Go")?.level).toBe("familiar");
    expect(state.profile.skills.find((s) => s.name === "Python")?.level).toBeUndefined();
  });

  it("exposes a four-step level enum and the mapping rule to the model", async () => {
    const prompts: string[] = [];
    const { controller } = fake([toolTurn(ask("你叫什么？"))], prompts);
    await collect(controller.handleUserMessage(createIntakeState(), { id: "m1", text: "你好" }));
    expect(prompts[0]).toContain("熟悉→familiar");
    const schema = JSON.stringify(toolJsonSchema(UpsertFactsArgs));
    expect(schema).toContain('"beginner","familiar","proficient","expert"');
  });
});

describe("intake controller: digging into one experience", () => {
  const seeded = () =>
    createIntakeState({
      profile: Profile.parse({
        basics: { name: "李明", phone: "13800001111", email: "liming@example.com" },
        education: [{ id: "edu_1", school: "示例大学", degree: "bachelor", major: "软件工程" }],
        projects: [{ id: "prj_1", name: "校园二手平台", role: "后端" }],
        skills: ["Java", "MySQL", "Git"].map((name, i) => ({ id: `skl_${i}`, name })),
        intention: { roles: ["后端开发"], cities: ["杭州"], jobType: "campus" },
      }),
      completedSections: ["experiences", "awards"],
    });
  const target = (prompt: string | undefined) => prompt?.match(/key=([\w:]+)/)?.[1];

  it("asks tech stack, duty, challenge, then numbers, and records 没有数字 as skipped", async () => {
    const prompts: string[] = [];
    const prj = (payload: JsonObject, quote: string) => ({
      section: "projects",
      payload: { name: "校园二手平台", ...payload },
      quote,
    });
    const { controller } = fake(
      [
        toolTurn(
          upsert([prj({ techStack: ["Java", "Spring Boot", "MySQL"] }, "Java、Spring Boot 和 MySQL")]),
        ),
        toolTurn(ask("你具体负责哪一块？")),
        toolTurn(
          upsert([
            prj(
              { highlights: [{ title: "订单模块设计", detail: "负责订单和支付回调模块" }] },
              "负责订单和支付回调模块",
            ),
          ]),
        ),
        toolTurn(ask("遇到过什么难点？")),
        toolTurn(
          upsert([
            prj(
              {
                techStack: ["Redis", "java"],
                highlights: [{ title: "超卖问题", detail: "用 Redis 分布式锁解决了超卖" }],
              },
              "用 Redis 分布式锁解决了超卖",
            ),
          ]),
        ),
        toolTurn(ask("最后效果怎么样？有数字吗？")),
        toolTurn(ask("那这个项目大概做了多久？")),
      ],
      prompts,
    );
    const state = seeded();
    const turn = (id: string, text: string) => collect(controller.handleUserMessage(state, { id, text }));

    await turn("m1", "Java、Spring Boot 和 MySQL");
    expect(target(prompts[0])).toBe("projects:prj_1:techStack");
    await turn("m2", "负责订单和支付回调模块");
    expect(target(prompts[2])).toBe("projects:prj_1:duty");
    const e3 = await turn("m3", "用 Redis 分布式锁解决了超卖");
    expect(target(prompts[4])).toBe("projects:prj_1:challenge");
    expect(asks(e3)[0]).toMatchObject({
      slot: expect.objectContaining({ field: "impact" }),
      quickReplies: ["没有具体数字", "记不清了"],
    });
    expect(state.profile.projects[0]?.techStack).toEqual(["Java", "Spring Boot", "MySQL", "Redis"]);
    expect(state.profile.projects[0]?.highlights?.map((h) => h.title)).toEqual(["订单模块设计", "超卖问题"]);

    await turn("m4", "没有具体数字，记不清了");
    expect(state.skipped).toEqual([
      expect.objectContaining({ key: "projects:prj_1:impact", quote: "没有具体数字" }),
    ]);
    expect(target(prompts[6])).not.toBe("projects:prj_1:impact");
    expect(prompts[6]).toContain("项目经历-校园二手平台-量化结果");
  });

  it("写入和追问在同一次回复里发出时，一轮只调一次模型", async () => {
    const core = createFauxCore({ models: [{ id: "fake-model" }] });
    core.setResponses([
      fauxAssistantMessage(
        [
          fauxText("Java 加 MySQL 挺扎实。这个项目里你具体负责哪一块？"),
          upsert([
            {
              section: "projects",
              payload: { name: "校园二手平台", techStack: ["Java", "MySQL"] },
              quote: "Java 和 MySQL",
            },
          ]),
          ask("这个项目里你具体负责哪一块？"),
        ],
        { stopReason: "toolUse" },
      ),
    ]);
    const prompts: string[] = [];
    const metrics: TurnMetrics[] = [];
    const controller = createIntakeController({
      streamFn: (model, context, options) => {
        const first = context.messages[0];
        if (first?.role === "system") prompts.push(JSON.stringify(first.content));
        return core.streamSimple(model, context, options);
      },
      model: core.getModel(),
      genId,
      onMetrics: (m) => metrics.push(m),
    });
    const state = seeded();
    const events = await collect(
      controller.handleUserMessage(state, { id: "m1", text: "用的 Java 和 MySQL" }),
    );

    expect(prompts).toHaveLength(1);
    expect(state.profile.projects[0]?.techStack).toEqual(["Java", "MySQL"]);
    expect(asks(events)).toEqual([expect.objectContaining({ inText: true })]);
    expect(state.history.at(-1)?.content).toBe("Java 加 MySQL 挺扎实。这个项目里你具体负责哪一块？");
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.modelCalls.map((c) => c.toolCalls)).toEqual([["upsert_facts", "ask_user"]]);
    expect(metrics[0]?.tools.map((t) => t.name)).toEqual(["upsert_facts", "ask_user"]);
    expect(metrics[0]?.firstTokenMs).toBeGreaterThanOrEqual(0);
  });

  it("同一次发出的写入被拒时，问题已送出，再给一次只改写入的机会", async () => {
    const prompts: string[] = [];
    const { controller } = fake(
      [
        fauxAssistantMessage(
          [
            fauxText("这个项目里你具体负责哪一块？"),
            upsert([
              {
                section: "projects",
                payload: { name: "校园二手平台", techStack: ["Java", "MySQL"] },
                quote: "Java 和 MySQL 还有 Redis",
              },
            ]),
            ask("这个项目里你具体负责哪一块？"),
          ],
          { stopReason: "toolUse" },
        ),
        (context) => {
          expect(JSON.stringify(context.messages.at(-1))).toContain("不要再输出文字");
          return toolTurn(
            upsert([
              {
                section: "projects",
                payload: { name: "校园二手平台", techStack: ["Java", "MySQL"] },
                quote: "Java 和 MySQL",
              },
            ]),
          );
        },
      ],
      prompts,
    );
    const state = seeded();
    const events = await collect(
      controller.handleUserMessage(state, { id: "m1", text: "用的 Java 和 MySQL" }),
    );

    expect(prompts).toHaveLength(2);
    expect(state.profile.projects[0]?.techStack).toEqual(["Java", "MySQL"]);
    expect(asks(events)).toHaveLength(1);
    expect(state.history.at(-1)?.content).toBe("这个项目里你具体负责哪一块？");
  });

  it("nudges once when the user answered the challenge but nothing was written", async () => {
    const answer = "碰到过中文乱码，后来把数据库和连接的编码都改成 UTF-8 就解决了";
    const { core, controller } = fake([
      fauxAssistantMessage([fauxText("这个问题挺典型的。")]),
      toolTurn(
        upsert([
          {
            section: "projects",
            payload: {
              name: "校园二手平台",
              highlights: [{ title: "中文乱码", detail: "将数据库及连接编码统一改为 UTF-8，解决中文乱码" }],
            },
            quote: answer,
          },
        ]),
        ask("最后效果怎么样？"),
      ),
    ]);
    const state = seeded();
    state.history.push({
      id: "a0",
      role: "assistant",
      content: "遇到过什么难点？",
      meta: { slot: "projects:prj_1:challenge" },
    });
    await collect(controller.handleUserMessage(state, { id: "m1", text: answer }));
    expect(core.state.callCount).toBe(2);
    expect(state.profile.projects[0]?.highlights?.map((h) => h.title)).toEqual(["中文乱码"]);
  });

  it("does not treat 记不清 as a skip when a different question is pending", async () => {
    const { controller } = fake([toolTurn(ask("你具体负责哪一块？"))]);
    const state = seeded();
    await collect(controller.handleUserMessage(state, { id: "m1", text: "记不清用了啥了" }));
    expect(state.skipped).toEqual([]);
  });
});

describe("intake controller: claimed but not written", () => {
  it("nudges the model once when it says 记下了 without calling upsert_facts", async () => {
    const { controller } = fake([
      fauxAssistantMessage([fauxText("好的，技能记下了。")]),
      toolTurn(
        upsert([{ section: "skills", payload: { name: "Python" }, quote: "我会 Python" }]),
        ask("还会别的吗？"),
      ),
    ]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "我会 Python" }));
    expect(state.profile.skills.map((s) => s.name)).toEqual(["Python"]);
    expect(asks(events).map((a) => a.question)).toEqual(["还会别的吗？"]);
    expect(state.history.filter((t) => t.role === "user").map((t) => t.content)).toEqual(["我会 Python"]);
  });

  it("同一次回复里还调了别的工具时，提醒也能送到模型", async () => {
    const { core, controller } = fake([
      fauxAssistantMessage(
        [
          fauxText("Python 记下了。还会别的吗？"),
          upsert([{ section: "skills", payload: { name: "Python" }, quote: "我会 Python 和 Go" }]),
          ask("还会别的吗？"),
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        expect(JSON.stringify(context.messages.at(-1))).toContain("你在回复里说已经记下");
        return toolTurn(upsert([{ section: "skills", payload: { name: "Python" }, quote: "我会 Python" }]));
      },
    ]);
    const state = createIntakeState();
    await collect(controller.handleUserMessage(state, { id: "m1", text: "我会 Python" }));
    expect(state.profile.skills.map((s) => s.name)).toEqual(["Python"]);
    expect(core.state.callCount).toBe(2);
  });

  it("does not flag a claim about something recorded in an earlier turn", async () => {
    const { core, controller } = fake([
      fauxAssistantMessage([fauxText("Java 和 MySQL 就先记下了。想找什么岗位？")]),
    ]);
    const state = createIntakeState({
      profile: Profile.parse({
        skills: [
          { id: "s1", name: "Java" },
          { id: "s2", name: "MySQL" },
        ],
      }),
    });
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "就这些了" }));
    expect(core.state.callCount).toBe(1);
    expect(asks(events).filter((a) => a.kind === "clarify")).toEqual([]);
  });

  it("does not nudge a plain answer that claims nothing", async () => {
    const { core, controller } = fake([fauxAssistantMessage([fauxText("一般一页就够。")])]);
    const state = createIntakeState();
    await collect(controller.handleUserMessage(state, { id: "m1", text: "简历写几页好？" }));
    expect(core.state.callCount).toBe(1);
  });
});

describe("intake controller: old profile data", () => {
  it("does not re-ask what an old project already says, and merges a retelling without duplicates", async () => {
    const state = createIntakeState({
      profile: Profile.parse({
        basics: { name: "李明", phone: "13800001111", email: "liming@example.com" },
        education: [{ id: "edu_1", school: "示例大学", degree: "bachelor", major: "软件工程" }],
        projects: [
          {
            id: "prj_old",
            name: "江城闲置",
            role: "后端负责人",
            techStack: ["Java", "Redis"],
            action: "负责后端，做了商品发布、搜索和订单模块，用 Redis 缓存热门商品",
            result: "接口响应从 800ms 降到 120ms",
          },
        ],
        skills: ["Java", "MySQL", "Git"].map((name, i) => ({ id: `skl_${i}`, name })),
        intention: { roles: ["后端开发"], cities: ["杭州"], jobType: "campus" },
      }),
      completedSections: ["experiences", "awards"],
    });
    const prj = (name: string, payload: JsonObject, quote: string) => ({
      section: "projects",
      payload: { name, ...payload },
      quote,
    });
    const { controller } = fake([
      toolTurn(upsert([prj("江城图书馆", {}, "课程项目叫江城图书馆")])),
      toolTurn(ask("你在里面担任什么角色？")),
      toolTurn(upsert([prj("江城图书馆", { role: "组长" }, "我是组长")])),
      toolTurn(ask("用了哪些技术？")),
      toolTurn(
        upsert([
          prj(
            "江城闲置",
            {
              highlights: [
                { title: "商品发布与搜索", detail: "商品发布、搜索" },
                { title: "订单模块", detail: "订单模块" },
              ],
            },
            "商品发布、搜索和订单模块",
          ),
        ]),
      ),
      toolTurn(ask("那江城闲置遇到过什么难点？")),
    ]);
    const slots: (string | undefined)[] = [];
    for (const [id, text] of [
      ["m1", "我还做过一个课程项目叫江城图书馆"],
      ["m2", "我是组长"],
      ["m3", "之前说过了呀，就是商品发布、搜索和订单模块"],
    ] as const) {
      const events = await collect(controller.handleUserMessage(state, { id, text }));
      const last = events.at(-1);
      slots.push(last?.type === "completeness" ? last.nextSlot?.key : undefined);
    }
    const newId = state.profile.projects.find((p) => p.name === "江城图书馆")?.id;
    expect(slots).toEqual([
      `projects:${newId}:role`,
      `projects:${newId}:techStack`,
      "projects:prj_old:challenge",
    ]);
    expect(slots.some((k) => k?.endsWith(":duty"))).toBe(false);
    expect(state.profile.projects[0]?.highlights).toEqual([
      { title: "商品发布与搜索", detail: "负责后端，做了商品发布、搜索和订单模块，用 Redis 缓存热门商品" },
      { detail: "接口响应从 800ms 降到 120ms" },
    ]);
  });
});

describe("intake controller: saying it was recorded must match what was written", () => {
  const claimTurn = (text: string, ...calls: ReturnType<typeof fauxToolCall>[]) =>
    fauxAssistantMessage([fauxText(text), ...calls], { stopReason: "toolUse" });
  const award = (quote: string) => upsert([{ section: "awards", payload: { name: "毕业答辩优秀" }, quote }]);
  const python = upsert([{ section: "skills", payload: { name: "Python" }, quote: "我会 Python" }]);
  const lastReply = (state: ReturnType<typeof createIntakeState>) =>
    state.history.findLast((t) => t.role === "assistant")?.content ?? "";

  it("corrects the reply when the write failed but the model said 记上了", async () => {
    const { core, controller } = fake([
      claimTurn("好的，答辩优秀也记上了。还拿过别的奖吗？", award("答辩被评为优秀"), ask("还拿过别的奖吗？")),
      toolTurn(award("答辩被评为优秀")),
    ]);
    const state = createIntakeState();
    const events = await collect(
      controller.handleUserMessage(state, { id: "m1", text: "我毕业答辩拿了优秀" }),
    );
    expect(core.state.callCount).toBe(2);
    expect(state.profile.awards).toHaveLength(0);
    const correction = asks(events).at(-1);
    expect(correction).toMatchObject({ kind: "clarify" });
    expect(correction?.question).toBe(
      "刚才说的「我毕业答辩拿了优秀」其实还没记进简历，回头可以再具体说一下。",
    );
    expect(lastReply(state)).toContain("还没记进简历");
  });

  it("corrects only the part that was not written when A was written but B was claimed", async () => {
    const { controller } = fake([
      claimTurn("Python 和答辩优秀都记上了。", python, ask("还会别的吗？")),
      toolTurn(ask("还会别的吗？")),
    ]);
    const state = createIntakeState();
    const events = await collect(
      controller.handleUserMessage(state, { id: "m1", text: "我会 Python，毕业答辩拿了优秀" }),
    );
    expect(state.profile.skills.map((s) => s.name)).toEqual(["Python"]);
    expect(asks(events).at(-1)?.question).toBe(
      "刚才说的「毕业答辩拿了优秀」其实还没记进简历，回头可以再具体说一下。",
    );
    expect(events.some((e) => e.type === "profile_patch")).toBe(true);
  });

  it("lets the nudged rewrite stand without a correction", async () => {
    const { controller } = fake([
      claimTurn("答辩优秀也记上了，还拿过别的奖吗？", ask("还拿过别的奖吗？")),
      toolTurn(award("毕业答辩拿了优秀")),
    ]);
    const state = createIntakeState();
    const events = await collect(
      controller.handleUserMessage(state, { id: "m1", text: "我毕业答辩拿了优秀" }),
    );
    expect(state.profile.awards.map((a) => a.name)).toEqual(["毕业答辩优秀"]);
    expect(asks(events).map((a) => a.kind)).toEqual(["followup"]);
    expect(lastReply(state)).not.toContain("还没记进");
  });

  it("does not nudge or correct a claim that matches what was written", async () => {
    const { core, controller } = fake([
      claimTurn("好的，技能和 Python 都记下了。还会别的吗？", python, ask("还会别的吗？")),
    ]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "我会 Python" }));
    expect(core.state.callCount).toBe(1);
    expect(asks(events).map((a) => a.kind)).toEqual(["followup"]);
  });

  it("treats a summary word the user never said as covered by any write this turn", async () => {
    const { core, controller } = fake([
      claimTurn(
        "联系方式我记好了，还会别的吗？",
        upsert([{ section: "basics", payload: { phone: "13600005555" }, quote: "电话13600005555" }]),
        ask("还会别的吗？"),
      ),
    ]);
    const events = await collect(
      controller.handleUserMessage(createIntakeState(), { id: "m1", text: "电话13600005555" }),
    );
    expect(core.state.callCount).toBe(1);
    expect(asks(events).map((a) => a.kind)).toEqual(["followup"]);
  });

  it("does not read advice like 写上 GPA 更好 as a claim", async () => {
    const { core, controller } = fake([
      claimTurn("你已经写过学校了，简历上写上 GPA 会更好，你的 GPA 是多少？", ask("你的 GPA 是多少？")),
    ]);
    await collect(controller.handleUserMessage(createIntakeState(), { id: "m1", text: "GPA 要写吗" }));
    expect(core.state.callCount).toBe(1);
  });

  it("tells the model not to announce writes itself", async () => {
    const prompts: string[] = [];
    const { controller } = fake([toolTurn(ask("你叫什么？"))], prompts);
    await collect(controller.handleUserMessage(createIntakeState(), { id: "m1", text: "你好" }));
    expect(prompts[0]).toContain("不要说「记下了」「已记录」「记上了」");
  });
});

describe("intake controller: declining a deep-dive question", () => {
  const CHALLENGE = "projects:prj_1:challenge";
  const seeded = (askedSlot?: string) =>
    createIntakeState({
      profile: Profile.parse({
        basics: { name: "李明", phone: "13800001111", email: "liming@example.com" },
        education: [{ id: "edu_1", school: "江城大学", degree: "bachelor", major: "软件工程" }],
        projects: [
          {
            id: "prj_1",
            name: "江城闲置",
            role: "后端",
            techStack: ["Java"],
            highlights: [{ title: "订单模块", detail: "负责订单模块" }],
          },
        ],
        skills: ["Java", "MySQL", "Git"].map((name, i) => ({ id: `skl_${i}`, name })),
        intention: { roles: ["后端开发"], cities: ["江城"], jobType: "campus" },
      }),
      completedSections: ["experiences", "awards"],
      history: askedSlot
        ? [
            { id: "m0", role: "user", content: "负责订单模块" },
            {
              id: "m0:reply",
              role: "assistant",
              content: "做的过程中遇到过什么难点？",
              meta: { slot: askedSlot },
            },
          ]
        : [],
    });
  const target = (prompt: string | undefined) => prompt?.match(/key=([\w:]+)/)?.[1];
  const skip = (key: string, quote: string) => fauxToolCall("skip_field", { key, quote });

  it("records 没遇到特别难的 as a skip without the model and moves on", async () => {
    const prompts: string[] = [];
    const { controller } = fake([toolTurn(ask("最后效果怎么样？"))], prompts);
    const state = seeded(CHALLENGE);
    await collect(controller.handleUserMessage(state, { id: "m1", text: "没遇到特别难的" }));
    expect(state.skipped).toEqual([expect.objectContaining({ key: CHALLENGE, quote: "没遇到特别难的" })]);
    expect(target(prompts[0])).toBe("projects:prj_1:impact");
    expect(prompts[0]).toContain("系统已记为跳过");
  });

  it("leaves a longer answer with real content to the model", async () => {
    const { controller } = fake([toolTurn(ask("最后效果怎么样？"))]);
    const state = seeded(CHALLENGE);
    await collect(
      controller.handleUserMessage(state, { id: "m1", text: "没遇到什么大问题，就是 Redis 缓存要注意" }),
    );
    expect(state.skipped).toEqual([]);
  });

  it("falls back to the slot asked last turn when skip_field gets a wrong key", async () => {
    const { controller } = fake([
      toolTurn(skip("challenge", "这块就不说了吧")),
      toolTurn(ask("最后效果怎么样？")),
    ]);
    const state = seeded(CHALLENGE);
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "这块就不说了吧" }));
    expect(state.skipped.map((e) => e.key)).toEqual([CHALLENGE]);
    expect(asks(events).map((a) => a.kind)).toEqual(["followup"]);
  });

  it("treats skipping a field that already has content as a no-op, not a failure", async () => {
    const { core, controller } = fake([
      toolTurn(skip("projects:prj_1:duty", "没遇到特别难的")),
      toolTurn(ask("最后效果怎么样？")),
    ]);
    const state = seeded();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "没遇到特别难的" }));
    expect(core.state.callCount).toBe(2);
    expect(state.skipped).toEqual([]);
    expect(asks(events).map((a) => a.kind)).toEqual(["followup"]);
  });

  it("skips the target itself after two bad skip_field calls instead of a clarify loop", async () => {
    const prompts: string[] = [];
    const { core, controller } = fake(
      [
        toolTurn(skip("challenge", "没遇到特别难的")),
        toolTurn(skip("江城闲置:challenge", "没遇到特别难的")),
        fauxAssistantMessage([fauxText("应届生一页就够了。"), ask("这个项目最后效果怎么样？")], {
          stopReason: "toolUse",
        }),
      ],
      prompts,
    );
    const state = seeded();
    const e1 = await collect(controller.handleUserMessage(state, { id: "m1", text: "没遇到特别难的" }));
    expect(core.state.callCount).toBe(2);
    expect(asks(e1).map((a) => [a.kind, a.slot?.key])).toEqual([["followup", "projects:prj_1:impact"]]);
    expect(state.skipped).toEqual([expect.objectContaining({ key: CHALLENGE, quote: "没遇到特别难的" })]);

    const e2 = await collect(controller.handleUserMessage(state, { id: "m2", text: "简历一般写几页？" }));
    expect(prompts.slice(2).map(target)).not.toContain(CHALLENGE);
    expect(asks(e2).some((a) => a.kind === "clarify")).toBe(false);
    expect(state.history.at(-1)?.content).toContain("一页就够了");
  });

  it("asks the user to clarify the same failed words only once", async () => {
    const bad = upsert([
      { section: "education", payload: { school: "清华大学", degree: "本科" }, quote: "清华大学本科" },
    ]);
    const { controller } = fake([toolTurn(bad), toolTurn(bad), toolTurn(bad), toolTurn(bad)]);
    const state = createIntakeState();
    const e1 = await collect(controller.handleUserMessage(state, { id: "m1", text: "我在清华大学本科" }));
    expect(asks(e1).map((a) => a.kind)).toEqual(["clarify"]);
    const e2 = await collect(controller.handleUserMessage(state, { id: "m2", text: "就是清华大学本科" }));
    expect(asks(e2).map((a) => a.kind)).toEqual(["followup"]);
    expect(state.history.at(-1)?.content).toBeTruthy();
  });
});

describe("intake controller: replaying intake tool calls", () => {
  it("records effective intake calls on the reply and replays them after its text next turn", async () => {
    let seen: unknown[] = [];
    const { controller } = fake([
      toolTurn(
        upsert([
          { section: "basics", payload: { name: "王小明" }, quote: "我叫王小明" },
          { section: "basics", payload: { phone: "13900002222" }, quote: "电话 13900002222" },
        ]),
        fauxToolCall("skip_field", { quote: "没说过这句" }),
      ),
      toolTurn(ask("手机号方便留一个吗？")),
      (context) => {
        seen = context.messages.filter((m) => m.role !== "system");
        return fauxAssistantMessage([fauxText("好的。")]);
      },
    ]);
    const state = createIntakeState();
    await collect(controller.handleUserMessage(state, { id: "m1", text: "我叫王小明" }));

    const tools = state.history.at(-1)?.meta?.tools;
    expect(tools).toEqual([
      {
        name: "upsert_facts",
        args: { facts: [{ section: "basics", payload: { name: "王小明" }, quote: "我叫王小明" }] },
        result: "已写入 1 条事实。",
      },
    ]);

    await collect(controller.handleUserMessage(state, { id: "m2", text: "不方便" }));
    const roles = seen.map((m) => (m as { role: string }).role);
    expect(roles).toEqual(["user", "assistant", "toolResult", "user"]);
    const replayed = JSON.stringify(seen[1]);
    expect(replayed.indexOf("手机号方便留一个吗")).toBeLessThan(replayed.indexOf('"name":"upsert_facts"'));
    expect(replayed).not.toContain("13900002222");
    expect(JSON.stringify(seen[2])).toContain("已写入 1 条事实。");
    expect(JSON.stringify(seen)).not.toContain("ask_user");
  });

  it("replays old histories that carry no intake records", async () => {
    let seen: unknown[] = [];
    const { controller } = fake([
      (context) => {
        seen = context.messages.filter((m) => m.role !== "system");
        return toolTurn(ask("学校是哪所？"));
      },
    ]);
    const state = createIntakeState({
      history: [
        { id: "o1", role: "user", content: "我叫王小明" },
        {
          id: "o1:reply",
          role: "assistant",
          content: "你好小明，手机号是多少？",
          meta: { slot: "basics:_:phone" },
        },
      ],
    });
    await collect(controller.handleUserMessage(state, { id: "m1", text: "13900002222" }));
    expect(seen.map((m) => (m as { role: string }).role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("replayRecord", () => {
  const facts = [
    { section: "skills", payload: { name: "Rust" }, quote: "会 Rust" },
    { section: "skills", payload: { name: "Go" }, quote: "会 Go" },
    { section: "skills", payload: { name: "Java" }, quote: "会 Java" },
  ];

  it("drops rejected facts, renumbers the rest and strips per-turn guidance", () => {
    const result = [
      "已写入 1 条事实。",
      "第 3 条和已记录的内容一样，不用重复写入。",
      "被拒绝：",
      "第 1 条：quote「会 Rust」不是用户说过的原话",
      "下一个目标：",
      "- 技能",
    ].join("\n");
    expect(replayRecord("upsert_facts", { facts }, result, false)).toEqual({
      name: "upsert_facts",
      args: { facts: facts.slice(1) },
      result: "已写入 1 条事实。\n第 2 条和已记录的内容一样，不用重复写入。",
    });
  });

  it("skips calls that changed nothing", () => {
    const allRejected = "已写入 0 条事实。\n被拒绝：\n第 1 条：x\n第 2 条：y\n第 3 条：z";
    expect(replayRecord("upsert_facts", { facts }, allRejected, true)).toBeUndefined();
    expect(replayRecord("upsert_facts", {}, "参数校验失败：facts 必填", true)).toBeUndefined();
    expect(
      replayRecord("complete_section", { section: "skills" }, "「技能」还缺必填信息", true),
    ).toBeUndefined();
    expect(
      replayRecord(
        "skip_field",
        { key: "basics:_:name", quote: "不说" },
        "key=basics:_:name 已有内容",
        false,
      ),
    ).toBeUndefined();
    expect(
      replayRecord("ask_user", { question: "学校？" }, "问题已发送给用户，等待回答。", false),
    ).toBeUndefined();
    expect(replayRecord("recommend_jobs", {}, "推荐列表", false)).toBeUndefined();
  });

  it("keeps successful skips and completions without the next target, capped in length", () => {
    expect(
      replayRecord(
        "complete_section",
        { section: "awards", reason: "done" },
        "已完成「奖项」。\n所有分区均已完成。",
        false,
      ),
    ).toEqual({
      name: "complete_section",
      args: { section: "awards", reason: "done" },
      result: "已完成「奖项」。",
    });
    const long = `已写入 1 条事实。\n${"暂存说明".repeat(200)}`;
    expect(
      replayRecord("upsert_facts", { facts: facts.slice(0, 1) }, long, false)?.result.length,
    ).toBeLessThanOrEqual(401);
  });
});
