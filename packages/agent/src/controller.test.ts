import {
  createFauxCore,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type JsonObject,
} from "@earendil-works/pi-ai";
import { createGateway, loadGatewayConfig } from "@talksume/llm-gateway";
import { describe, expect, it } from "vitest";
import { createIntakeController } from "./controller.ts";
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

  it("rejects a new item with missing required fields and tells the model to ask", async () => {
    const { controller, core } = fake([
      toolTurn(upsert([{ section: "education", payload: { school: "清华大学" }, quote: "清华大学" }])),
      toolTurn(ask("读的是本科还是研究生？")),
    ]);
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "m1", text: "我是清华大学的" }));
    expect(state.profile.education).toHaveLength(0);
    expect(asks(events)[0]).toMatchObject({ kind: "followup" });
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
