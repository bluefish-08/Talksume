import {
  createFauxCore,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppDeps, buildApp } from "../app.ts";
import { loadUserMemory } from "../conversation-store.ts";
import { unsummarizedConversation } from "../memory-store.ts";

let handle: DbHandle;
let app: FastifyInstance;

const toolTurn = (...calls: ReturnType<typeof fauxToolCall>[]) =>
  fauxAssistantMessage(calls, { stopReason: "toolUse" });
const nameFact = fauxToolCall("upsert_facts", {
  facts: [{ section: "basics", payload: { name: "李明" }, quote: "我叫李明" }],
});
const ask = (question: string) => fauxToolCall("ask_user", { question });

function fakeLlm(steps: FauxResponseStep[]): NonNullable<AppDeps["llm"]> {
  const core = createFauxCore({ models: [{ id: "fake-model" }] });
  core.setResponses(steps);
  const resolved = { streamFn: core.streamSimple.bind(core), model: core.getModel() };
  return { models: [{ id: "fake-model", label: "测试模型", hint: "" }], resolve: () => resolved };
}

async function boot(llm?: AppDeps["llm"], extra: Partial<AppDeps> = {}) {
  app = buildApp({ edition: "cloud", version: "t", db: handle.db, ...(llm && { llm }), ...extra });
  await app.ready();
}

async function createConversation(headers: Record<string, string> = {}) {
  const res = await app.inject({ method: "POST", url: "/api/v1/conversations", headers });
  return res.json().id as string;
}

const del = (id: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "DELETE", url: `/api/v1/conversations/${id}`, headers });
const restore = (id: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: `/api/v1/conversations/${id}/restore`, headers });
const get = (id: string) => app.inject({ method: "GET", url: `/api/v1/conversations/${id}` });
const list = async () =>
  ((await app.inject({ method: "GET", url: "/api/v1/conversations" })).json().items as { id: string }[]).map(
    (c) => c.id,
  );

async function otherUser() {
  const [row] = await handle.db
    .insert(schema.users)
    .values({ email: "other@example.com" })
    .returning({ id: schema.users.id });
  return { "x-talksume-user": row?.id ?? "" };
}

beforeEach(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
});

afterEach(async () => {
  await app?.close();
  await handle.close();
});

describe("删除会话", () => {
  it("删除后列表、详情、发消息、重命名都是 404，消息记录仍在库里", async () => {
    await boot(fakeLlm([toolTurn(ask("手机号？"))]));
    const keep = await createConversation();
    const id = await createConversation();

    const res = await del(id);
    expect(res.statusCode).toBe(204);

    expect(await list()).toEqual([keep]);
    expect((await get(id)).statusCode).toBe(404);
    const send = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${id}/messages`,
      payload: { content: "你好" },
    });
    expect(send.statusCode).toBe(404);
    const rename = await app.inject({
      method: "PATCH",
      url: `/api/v1/conversations/${id}`,
      payload: { title: "新标题" },
    });
    expect(rename.statusCode).toBe(404);

    const rows = await handle.db.select().from(schema.messages).where(eq(schema.messages.conversationId, id));
    expect(rows).toHaveLength(1);
    expect((await get(keep)).statusCode).toBe(200);
  });

  it("重复删除和不存在的 id 都是 404", async () => {
    await boot();
    const id = await createConversation();
    expect((await del(id)).statusCode).toBe(204);
    const again = await del(id);
    expect(again.statusCode).toBe(404);
    expect(again.json()).toMatchObject({ code: "conversation_not_found" });
    expect((await del("nope")).statusCode).toBe(404);
    expect((await del("00000000-0000-4000-8000-000000000000")).statusCode).toBe(404);
  });

  it("别人的会话删不掉也撤销不了，自己的会话不受影响", async () => {
    await boot();
    const id = await createConversation();
    const other = await otherUser();

    expect((await del(id, other)).statusCode).toBe(404);
    expect(await list()).toEqual([id]);

    expect((await del(id)).statusCode).toBe(204);
    expect((await restore(id, other)).statusCode).toBe(404);
    expect((await get(id)).statusCode).toBe(404);
  });
});

describe("撤销删除", () => {
  it("撤销后会话回到列表，标题、消息和原来的排序都在", async () => {
    await boot();
    const first = await createConversation();
    const second = await createConversation();
    await app.inject({
      method: "PATCH",
      url: `/api/v1/conversations/${first}`,
      payload: { title: "实习经历" },
    });

    await del(first);
    expect(await list()).toEqual([second]);

    const res = await restore(first);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: first, title: "实习经历" });
    expect((await list()).sort()).toEqual([first, second].sort());
    const detail = (await get(first)).json();
    expect(detail.messages).toHaveLength(1);
    expect(detail.title).toBe("实习经历");
  });

  it("没删除过的会话、不存在的 id 撤销返回 404", async () => {
    await boot();
    const id = await createConversation();
    expect((await restore(id)).statusCode).toBe(404);
    expect((await restore("nope")).statusCode).toBe(404);
  });
});

describe("删除不影响用户级数据", () => {
  it("画像和事实保留，/facts 里指向被删会话的来源置空，撤销后恢复", async () => {
    await boot(fakeLlm([toolTurn(nameFact), toolTurn(ask("手机号？"))]));
    const id = await createConversation();
    await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${id}/messages`,
      payload: { content: "我叫李明" },
    });
    const before = (await app.inject({ method: "GET", url: "/api/v1/facts" })).json().items;
    expect(before).toHaveLength(1);
    expect(before[0].sourceMessageId).toBeTruthy();

    await del(id);

    const facts = await handle.db.select().from(schema.profileFacts);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.sourceMessageId).toBe(before[0].sourceMessageId);
    const profile = (await app.inject({ method: "GET", url: "/api/v1/profile" })).json();
    expect(profile.profile.basics.name).toBe("李明");

    const after = (await app.inject({ method: "GET", url: "/api/v1/facts" })).json().items;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ quote: "我叫李明", sourceMessageId: null });

    await restore(id);
    const back = (await app.inject({ method: "GET", url: "/api/v1/facts" })).json().items;
    expect(back[0].sourceMessageId).toBe(before[0].sourceMessageId);
  });

  it("被删会话的摘要不再进入记忆，也不再被补摘要；撤销后恢复", async () => {
    await boot(fakeLlm([toolTurn(nameFact), toolTurn(ask("手机号？"))]), {
      summarizer: async () => ({ summary: "聊了基本信息", topic: "基本信息" }),
    });
    const a = await createConversation();
    await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${a}/messages`,
      payload: { content: "我叫李明" },
    });
    const b = await createConversation();
    await vi.waitFor(async () => {
      expect(await handle.db.select().from(schema.conversationSummaries)).toHaveLength(1);
    });
    const userId = (await handle.db.select().from(schema.users))[0]?.id ?? "";
    expect((await loadUserMemory(handle.db, userId)).summaries).toHaveLength(1);

    await del(a);
    expect((await loadUserMemory(handle.db, userId)).summaries).toEqual([]);
    expect(await handle.db.select().from(schema.conversationSummaries)).toHaveLength(1);

    await restore(a);
    expect((await loadUserMemory(handle.db, userId)).summaries).toHaveLength(1);

    const [gone] = await handle.db
      .insert(schema.conversations)
      .values({ userId, deletedAt: new Date() })
      .returning({ id: schema.conversations.id });
    await handle.db
      .insert(schema.messages)
      .values({ conversationId: gone?.id ?? "", role: "user", content: "我想找实习" });
    expect(await unsummarizedConversation(handle.db, userId, b)).toBeUndefined();
  });
});
