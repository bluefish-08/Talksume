import {
  createFauxCore,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type JsonObject,
} from "@earendil-works/pi-ai";
import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { createGateway, loadGatewayConfig } from "@talksume/llm-gateway";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppDeps, buildApp } from "../app.ts";
import { gatewayLlm } from "../llm.ts";

interface Sse {
  event: string;
  data: Record<string, unknown>;
}

function parseSse(body: string): Sse[] {
  return body
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("event:"))
    .map((chunk) => {
      const [event, data] = chunk.split("\n");
      return { event: (event ?? "").slice(7), data: JSON.parse((data ?? "").slice(6)) };
    });
}

const toolTurn = (...calls: ReturnType<typeof fauxToolCall>[]) =>
  fauxAssistantMessage(calls, { stopReason: "toolUse" });
const upsert = (facts: JsonObject[]) => fauxToolCall("upsert_facts", { facts });
const ask = (question: string) => fauxToolCall("ask_user", { question });

let handle: DbHandle;
let app: FastifyInstance;
const n = 0;

type Resolved = ReturnType<NonNullable<AppDeps["llm"]>["resolve"]>;

function single(resolved: Resolved): NonNullable<AppDeps["llm"]> {
  return { models: [{ id: resolved.model.id, label: "测试模型", hint: "" }], resolve: () => resolved };
}

function fakeLlm(steps: FauxResponseStep[]): NonNullable<AppDeps["llm"]> {
  const core = createFauxCore({ models: [{ id: "fake-model" }] });
  core.setResponses(steps);
  return single({ streamFn: (m, c, o) => core.streamSimple(m, c, o), model: core.getModel() });
}

async function boot(llm?: AppDeps["llm"]) {
  app = buildApp({ edition: "cloud", version: "t", db: handle.db, ...(llm && { llm }) });
  await app.ready();
}

async function createConversation(headers: Record<string, string> = {}) {
  const res = await app.inject({ method: "POST", url: "/api/v1/conversations", headers });
  return { res, id: res.json().id as string };
}

async function send(id: string, content: string, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${id}/messages`,
    headers,
    payload: { content },
  });
  return { res, events: parseSse(res.body) };
}

const messageCount = async (id: string) =>
  (await handle.db.select().from(schema.messages).where(eq(schema.messages.conversationId, id))).length;

beforeEach(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
});

afterEach(async () => {
  await app?.close();
  await handle.close();
});

describe("创建与读取会话", () => {
  it("创建会话返回开场问题，并作为第一条助手消息保存", async () => {
    await boot();
    const { res, id } = await createConversation();
    expect(res.statusCode).toBe(201);
    expect(res.json().greeting).toContain("怎么称呼你");

    const detail = (await app.inject({ method: "GET", url: `/api/v1/conversations/${id}` })).json();
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]).toMatchObject({ role: "assistant", content: res.json().greeting });
    expect(detail.completeness.score).toBe(0);
    expect(detail.resume).toEqual({ basics: { name: "", contacts: [] }, sections: [] });
    expect(detail.conflicts).toEqual([]);
  });

  it("别人的会话和格式不对的 id 都是 404", async () => {
    await boot();
    const { id } = await createConversation();
    const [other] = await handle.db
      .insert(schema.users)
      .values({ email: "other@example.com" })
      .returning({ id: schema.users.id });
    const headers = { "x-talksume-user": other?.id ?? "" };
    const foreign = await app.inject({ method: "GET", url: `/api/v1/conversations/${id}`, headers });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ code: "conversation_not_found", retryable: false });
    expect((await app.inject({ method: "GET", url: "/api/v1/conversations/nope" })).statusCode).toBe(404);
  });

  it("列表只含自己的会话，最近更新的在前", async () => {
    await boot();
    const first = await createConversation();
    const second = await createConversation();
    const [other] = await handle.db
      .insert(schema.users)
      .values({ email: "other@example.com" })
      .returning({ id: schema.users.id });
    await createConversation({ "x-talksume-user": other?.id ?? "" });
    const list = (await app.inject({ method: "GET", url: "/api/v1/conversations" })).json();
    expect(list.items.map((c: { id: string }) => c.id)).toEqual([second.id, first.id]);
    expect(list.items[0]).toMatchObject({ title: null });
  });
});

describe("发送消息（SSE）", () => {
  it("没配模型时返回 503 llm_unavailable", async () => {
    await boot();
    const { id } = await createConversation();
    const { res } = await send(id, "你好");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "llm_unavailable" });
  });

  it("校验请求体", async () => {
    await boot(fakeLlm([]));
    const { id } = await createConversation();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${id}/messages`,
      payload: { content: "   " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("模型选项：没配模型 503，配了返回模型列表和默认开思考", async () => {
    await boot();
    const off = await app.inject({ method: "GET", url: "/api/v1/llm/options" });
    expect(off.statusCode).toBe(503);
    await app.close();

    const gateway = createGateway(loadGatewayConfig({ LLM_BASE_URL: "http://x/v1", LLM_API_KEY: "k" }));
    await boot(gatewayLlm(gateway));
    const res = await app.inject({ method: "GET", url: "/api/v1/llm/options" });
    expect(res.json()).toEqual({
      models: [
        { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", hint: expect.any(String) },
        { id: "glm-5.3", label: "GLM-5.3", hint: expect.any(String) },
      ],
      default: { model: "deepseek-v4.1-flash", thinking: true },
    });
  });

  it("按请求里的 model / thinking 选模型，不传时默认首个模型并开思考，未知模型 400", async () => {
    const core = createFauxCore({ models: [{ id: "model-a" }, { id: "model-b" }] });
    core.setResponses([toolTurn(ask("继续？")), toolTurn(ask("继续？"))]);
    const choices: unknown[] = [];
    await boot({
      models: [
        { id: "model-a", label: "A", hint: "" },
        { id: "model-b", label: "B", hint: "" },
      ],
      resolve: (choice) => {
        choices.push(choice);
        return {
          streamFn: (m, c, o) => core.streamSimple(m, c, o),
          model: core.getModel(choice.model) ?? core.getModel(),
        };
      },
    });
    const { id } = await createConversation();
    await send(id, "你好");
    const picked = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${id}/messages`,
      payload: { content: "换个模型", model: "model-b", thinking: false },
    });
    expect(picked.statusCode).toBe(200);
    expect(choices).toEqual([
      { model: "model-a", thinking: true },
      { model: "model-b", thinking: false },
    ]);

    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${id}/messages`,
      payload: { content: "你好", model: "gpt-x" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: "invalid_model" });
  });

  it("一轮对话：事件顺序、SSE 头，画像与消息落库", async () => {
    await boot(
      fakeLlm([
        fauxAssistantMessage(
          [
            fauxText("你好李明！"),
            upsert([{ section: "basics", payload: { name: "李明" }, quote: "我叫李明" }]),
          ],
          { stopReason: "toolUse" },
        ),
        toolTurn(ask("方便留个手机号吗？")),
      ]),
    );
    const { id } = await createConversation();
    const { res, events } = await send(id, "我叫李明");

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["x-accel-buffering"]).toBe("no");
    expect(res.headers["cache-control"]).toContain("no-transform");
    expect(res.headers["content-encoding"]).toBeUndefined();

    const names = events.map((e) => e.event);
    expect(names.slice(0, names.indexOf("profile_patch"))).toEqual(
      Array(names.indexOf("profile_patch")).fill("token"),
    );
    expect(names.slice(names.indexOf("profile_patch"))).toEqual([
      "profile_patch",
      "ask",
      "completeness",
      "done",
    ]);
    const tokens = events.filter((e) => e.event === "token").map((e) => e.data.text);
    expect(tokens.join("")).toBe("你好李明！");
    expect(events.find((e) => e.event === "ask")?.data).toMatchObject({ kind: "followup" });

    const done = events.at(-1)?.data as { messageId: string; resume: { basics: { name: string } } };
    expect(done.resume.basics.name).toBe("李明");

    const [row] = await handle.db.select().from(schema.profiles);
    expect(row?.version).toBe(1);
    expect(row?.data.basics.name).toBe("李明");
    const facts = await handle.db.select().from(schema.profileFacts);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ quote: "我叫李明", status: "confirmed" });

    const detail = (await app.inject({ method: "GET", url: `/api/v1/conversations/${id}` })).json();
    expect(detail.messages.map((m: { role: string }) => m.role)).toEqual(["assistant", "user", "assistant"]);
    expect(detail.messages[2].id).toBe(done.messageId);
    expect(detail.messages[2].content).toContain("方便留个手机号吗？");
    expect(facts[0]?.sourceMessageId).toBe(detail.messages[1].id);
    expect(detail.profile.basics.name).toBe("李明");

    const profile = (await app.inject({ method: "GET", url: "/api/v1/profile" })).json();
    expect(profile).toMatchObject({ version: 1, profile: { basics: { name: "李明" } } });
    const resume = (await app.inject({ method: "GET", url: "/api/v1/resume" })).json();
    expect(resume.resume.basics.name).toBe("李明");
  });

  it("续聊：第二条消息接着第一条的状态，画像版本递增", async () => {
    await boot(
      fakeLlm([
        toolTurn(upsert([{ section: "basics", payload: { name: "李明" }, quote: "我叫李明" }])),
        toolTurn(ask("手机号？")),
        toolTurn(upsert([{ section: "basics", payload: { phone: "13800000000" }, quote: "13800000000" }])),
        toolTurn(ask("邮箱？")),
      ]),
    );
    const { id } = await createConversation();
    await send(id, "我叫李明");
    await send(id, "手机号是 13800000000");

    const [row] = await handle.db.select().from(schema.profiles);
    expect(row?.version).toBe(2);
    expect(row?.data.basics).toMatchObject({ name: "李明", phone: "13800000000" });
    expect(await messageCount(id)).toBe(5);
    const [conv] = await handle.db.select().from(schema.conversations);
    expect(conv?.intakeState.askCounts).toBeDefined();
    expect(conv?.title).toBe("我叫李明");
  });

  it("模型额度耗尽：推 error(recoverable=false) 和空 done，不写入任何消息", async () => {
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
    await boot(gatewayLlm(gateway));
    const { id } = await createConversation();
    const { events } = await send(id, "你好");

    expect(events.map((e) => e.event)).toEqual(["error", "completeness", "done"]);
    expect(events[0]?.data).toMatchObject({ code: "quota_exhausted", recoverable: false });
    expect(events.at(-1)?.data.messageId).toBeNull();
    expect(await messageCount(id)).toBe(1);
  });

  it("客户端断开时中止模型调用，且不保存半截结果", async () => {
    const core = createFauxCore({ models: [{ id: "fake-model" }], tokensPerSecond: 20 });
    core.setResponses([fauxAssistantMessage("这是一段很长的回复。".repeat(40))]);
    let signal: AbortSignal | undefined;
    await boot(
      single({
        streamFn: (m, c, o) => {
          signal = o?.signal;
          return core.streamSimple(m, c, o);
        },
        model: core.getModel(),
      }),
    );
    const { id } = await createConversation();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${address}/api/v1/conversations/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "你好" }),
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    await reader?.read();
    controller.abort();

    await expect.poll(() => signal?.aborted, { timeout: 5000 }).toBe(true);
    await expect.poll(async () => messageCount(id), { timeout: 2000 }).toBe(1);
  });

  it("同一会话并发发送第二条消息返回 409", async () => {
    const core = createFauxCore({ models: [{ id: "fake-model" }], tokensPerSecond: 50 });
    core.setResponses([fauxAssistantMessage("好的。".repeat(30)), fauxAssistantMessage("好的。")]);
    await boot(single({ streamFn: (m, c, o) => core.streamSimple(m, c, o), model: core.getModel() }));
    const { id } = await createConversation();
    const first = send(id, "第一条");
    await expect.poll(() => core.state.callCount, { timeout: 2000 }).toBe(1);
    const second = await send(id, "第二条");
    expect(second.res.statusCode).toBe(409);
    expect(second.res.json()).toMatchObject({ code: "conversation_busy", retryable: true });
    await first;
  });
});

describe("矛盾确认", () => {
  const cityTurns = (city: string, quote: string) => [
    toolTurn(upsert([{ section: "basics", payload: { city }, quote }])),
    toolTurn(ask("继续聊聊？")),
  ];

  async function conflictConversation(afterResolve: FauxResponseStep[] = []) {
    await boot(
      fakeLlm([
        ...cityTurns("上海", "我在上海"),
        // 矛盾出现后本轮不再追问，所以只有写入这一步
        toolTurn(upsert([{ section: "basics", payload: { city: "杭州" }, quote: "其实我在杭州" }])),
        ...afterResolve,
      ]),
    );
    const { id } = await createConversation();
    await send(id, "我在上海");
    const { events } = await send(id, "其实我在杭州");
    const confirm = events.find((e) => e.event === "ask")?.data as {
      kind: string;
      conflict: { factId: string };
    };
    return { id, confirm };
  }

  const resolve = async (id: string, factId: string, choice: string) => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${id}/conflicts/${factId}`,
      payload: { choice },
    });
    return { res, events: parseSse(res.body) };
  };

  it("矛盾落库，确认后采用新值，并在同一条 SSE 里接着追问", async () => {
    const { id, confirm } = await conflictConversation([
      toolTurn(
        fauxToolCall("ask_user", {
          question: "你的手机号是多少？",
          quickReplies: ["138 开头的", "不方便留"],
        }),
      ),
    ]);
    expect(confirm.kind).toBe("confirm");
    const before = (await app.inject({ method: "GET", url: `/api/v1/conversations/${id}` })).json();
    expect(before.profile.basics.city).toBe("上海");
    expect(before.conflicts).toHaveLength(1);

    const { res, events } = await resolve(id, confirm.conflict.factId, "proposed");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(events.map((e) => e.event)).toEqual(["profile_patch", "ask", "completeness", "done"]);
    expect(events[1]?.data).toMatchObject({
      kind: "followup",
      question: "你的手机号是多少？",
      quickReplies: ["138 开头的", "不方便留"],
    });
    const done = events.at(-1)?.data as { messageId: string; conflicts: unknown[] };
    expect(done.conflicts).toEqual([]);

    const [row] = await handle.db.select().from(schema.profiles);
    expect(row?.data.basics.city).toBe("杭州");
    expect(row?.version).toBe(2);
    const [fact] = await handle.db
      .select()
      .from(schema.profileFacts)
      .where(eq(schema.profileFacts.id, confirm.conflict.factId));
    expect(fact?.status).toBe("confirmed");

    const detail = (await app.inject({ method: "GET", url: `/api/v1/conversations/${id}` })).json();
    const last = detail.messages.at(-1);
    expect(last.id).toBe(done.messageId);
    expect(last).toMatchObject({
      role: "assistant",
      content: "你的手机号是多少？",
      quickReplies: ["138 开头的", "不方便留"],
    });
    expect(last.changes).toMatchObject([
      { section: "basics", field: "city", value: "杭州", previous: "上海" },
    ]);

    const again = await resolve(id, confirm.conflict.factId, "proposed");
    expect(again.res.statusCode).toBe(404);
    expect(again.res.json().code).toBe("conflict_not_found");
  });

  it("「已写入」变更和快捷回复随消息历史返回", async () => {
    await boot(
      fakeLlm([
        toolTurn(upsert([{ section: "basics", payload: { name: "李明" }, quote: "我叫李明" }])),
        toolTurn(
          fauxToolCall("ask_user", {
            question: "项目是独立做的吗？",
            quickReplies: ["是独立完成的", "和同学合作", "跳过这个"],
          }),
        ),
      ]),
    );
    const { id } = await createConversation();
    await send(id, "我叫李明");
    const detail = (await app.inject({ method: "GET", url: `/api/v1/conversations/${id}` })).json();
    const [greeting, userMsg, replyMsg] = detail.messages;
    expect(greeting).toMatchObject({ changes: [], quickReplies: [] });
    expect(userMsg).toMatchObject({ role: "user", changes: [], quickReplies: [] });
    expect(replyMsg.changes).toMatchObject([{ section: "basics", field: "name", value: "李明" }]);
    expect(replyMsg.quickReplies).toEqual(["是独立完成的", "和同学合作", "跳过这个"]);
  });

  it("没配模型时仍能处理待确认项，变更行照样落库", async () => {
    const { id, confirm } = await conflictConversation();
    await app.close();
    app = buildApp({ edition: "cloud", version: "t", db: handle.db });
    await app.ready();

    const { res, events } = await resolve(id, confirm.conflict.factId, "proposed");
    expect(res.statusCode).toBe(200);
    expect(events.map((e) => e.event)).toEqual(["profile_patch", "completeness", "done"]);
    const detail = (await app.inject({ method: "GET", url: `/api/v1/conversations/${id}` })).json();
    expect(detail.profile.basics.city).toBe("杭州");
    expect(detail.messages.at(-1).changes).toHaveLength(1);
  });

  it("选择保留旧值时画像不变，事实被标为被覆盖，助手仍接着追问", async () => {
    const { id, confirm } = await conflictConversation([toolTurn(ask("你的手机号是多少？"))]);
    const { events } = await resolve(id, confirm.conflict.factId, "previous");
    expect(events.map((e) => e.event)).toEqual(["ask", "completeness", "done"]);
    const detail = (await app.inject({ method: "GET", url: `/api/v1/conversations/${id}` })).json();
    expect(detail.profile.basics.city).toBe("上海");
    const [fact] = await handle.db
      .select()
      .from(schema.profileFacts)
      .where(eq(schema.profileFacts.id, confirm.conflict.factId));
    expect(fact?.status).toBe("superseded");
  });

  it("choice 不合法返回 400", async () => {
    const { id, confirm } = await conflictConversation();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${id}/conflicts/${confirm.conflict.factId}`,
      payload: { choice: "maybe" },
    });
    expect(res.statusCode).toBe(400);
  });
});
