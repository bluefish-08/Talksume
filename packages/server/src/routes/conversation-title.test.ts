import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppDeps, buildApp } from "../app.ts";
import type { ConversationTitler, TitleTurn } from "../conversation-title.ts";

let handle: DbHandle;
let app: FastifyInstance;

const askTurn = (question: string) =>
  fauxAssistantMessage([fauxToolCall("ask_user", { question })], { stopReason: "toolUse" });

function fakeLlm(rounds: number): NonNullable<AppDeps["llm"]> {
  const core = createFauxCore({ models: [{ id: "fake-model" }] });
  core.setResponses(Array.from({ length: rounds }, (_, i) => askTurn(`第 ${i + 1} 个问题？`)));
  const resolved = { streamFn: core.streamSimple.bind(core), model: core.getModel() };
  return { models: [{ id: "fake-model", label: "测试模型", hint: "" }], resolve: () => resolved };
}

interface Call {
  turns: TitleTurn[];
  current?: string;
}

function fakeTitler(reply: (call: Call, n: number) => Promise<string> | string) {
  const calls: Call[] = [];
  const titler: ConversationTitler = {
    generate: async (turns, { current }) => {
      const call = { turns, ...(current && { current }) };
      calls.push(call);
      return reply(call, calls.length);
    },
  };
  return { titler, calls };
}

async function boot(titler?: ConversationTitler, rounds = 4) {
  app = buildApp({
    edition: "cloud",
    version: "t",
    db: handle.db,
    llm: fakeLlm(rounds),
    ...(titler && { titler }),
  });
  await app.ready();
  const res = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  return res.json().id as string;
}

async function send(id: string, content: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${id}/messages`,
    payload: { content },
  });
  const done = res.body.split("\n\n").find((chunk) => chunk.startsWith("event: done"));
  return JSON.parse(done?.split("\n")[1]?.slice(6) ?? "{}") as { titlePending?: boolean };
}

const rename = (id: string, title: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: "PATCH", url: `/api/v1/conversations/${id}`, payload: { title }, headers });

async function stored(id: string) {
  const [row] = await handle.db.select().from(schema.conversations).where(eq(schema.conversations.id, id));
  return row;
}

const listTitle = async (id: string) =>
  (await app.inject({ method: "GET", url: "/api/v1/conversations" }))
    .json()
    .items.find((c: { id: string }) => c.id === id)?.title;

beforeEach(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
});

afterEach(async () => {
  await app?.close();
  await handle.close();
});

describe("自动生成会话标题", () => {
  it("第一轮回复完在后台生成，清洗后写入，列表能看到", async () => {
    const { titler, calls } = fakeTitler(() => "「李明的基本信息与项目」。");
    const id = await boot(titler);
    const done = await send(id, "你好，我叫李明，在江城大学读计算机");

    expect(done.titlePending).toBe(true);
    await vi.waitFor(async () => expect(await listTitle(id)).toBe("李明的基本信息与项目"));
    expect(calls[0]?.turns.map((t) => t.role)).toEqual(["assistant", "user", "assistant"]);
    expect(calls[0]?.turns[1]?.content).toContain("我叫李明");
    expect(calls[0]?.current).toBeUndefined();
    expect((await stored(id))?.titleSource).toBe("auto");
  });

  it("只在第 1、3 轮生成，第 3 轮带上当前标题，最多两次", async () => {
    const { titler, calls } = fakeTitler((_call, n) => (n === 1 ? "李明的基本信息" : "后台开发岗简历诊断"));
    const id = await boot(titler, 4);
    const pending: (boolean | undefined)[] = [];
    for (const text of ["我叫李明", "想投后台开发", "帮我看看简历", "还有别的建议吗"]) {
      pending.push((await send(id, text)).titlePending);
      await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(pending.filter(Boolean).length));
    }

    expect(pending).toEqual([true, false, true, false]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.current).toBe("李明的基本信息");
    expect(calls[1]?.turns.filter((t) => t.role === "user")).toHaveLength(3);
    await vi.waitFor(async () => expect(await listTitle(id)).toBe("后台开发岗简历诊断"));
  });

  it("模型失败时保留截断标题，第 3 轮不把截断标题当成当前标题", async () => {
    const { titler, calls } = fakeTitler((_call, n) => {
      if (n === 1) throw new Error("llm down");
      return "岗位推荐咨询";
    });
    const id = await boot(titler, 3);
    await send(id, "你好，我叫李明，想看看有哪些岗位适合我，最好在江城");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect((await stored(id))?.title).toBe("你好，我叫李明，想看看有哪些岗位适合我，最好在江城".slice(0, 30));

    await send(id, "本科");
    await send(id, "计算机");
    await vi.waitFor(async () => expect(await listTitle(id)).toBe("岗位推荐咨询"));
    expect(calls[1]?.current).toBeUndefined();
  });

  it("模型返回的内容清洗后为空时也保留截断标题", async () => {
    const { titler, calls } = fakeTitler(() => "「13800000000」");
    const id = await boot(titler);
    await send(id, "我叫李明");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await app.close();
    expect((await stored(id))?.title).toBe("我叫李明");
  });

  it("没配 titler 时不生成，done 里 titlePending 为 false", async () => {
    const id = await boot();
    expect((await send(id, "我叫李明")).titlePending).toBe(false);
    expect(await listTitle(id)).toBe("我叫李明");
  });
});

describe("重命名", () => {
  it("PATCH 改名后标记为 user，之后不再自动生成", async () => {
    const { titler, calls } = fakeTitler(() => "自动标题");
    const id = await boot(titler, 3);
    const res = await rename(id, "  我的  秋招简历 ");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id, title: "我的 秋招简历", titleSource: "user" });

    for (const text of ["我叫李明", "本科", "计算机"])
      expect((await send(id, text)).titlePending).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await listTitle(id)).toBe("我的 秋招简历");
  });

  it("生成过程中用户改了名，生成结果不覆盖", async () => {
    let release: (title: string) => void = () => {};
    const { titler, calls } = fakeTitler(() => new Promise<string>((resolve) => (release = resolve)));
    const id = await boot(titler);
    await send(id, "我叫李明");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await rename(id, "手动标题");
    release("自动标题");
    await app.close();
    expect(await stored(id)).toMatchObject({ title: "手动标题", titleSource: "user" });
  });

  it("空标题、超长标题 400，别人的或不存在的会话 404", async () => {
    const id = await boot();
    expect((await rename(id, "   ")).statusCode).toBe(400);
    expect((await rename(id, "长".repeat(41))).statusCode).toBe(400);
    expect((await rename(id, 42)).statusCode).toBe(400);
    expect((await rename("nope", "标题")).statusCode).toBe(404);
    expect((await rename("00000000-0000-4000-8000-000000000000", "标题")).statusCode).toBe(404);

    const [other] = await handle.db
      .insert(schema.users)
      .values({ email: "other@example.com" })
      .returning({ id: schema.users.id });
    const foreign = await rename(id, "标题", { "x-talksume-user": other?.id ?? "" });
    expect(foreign.statusCode).toBe(404);
    expect((await stored(id))?.titleSource).toBe("auto");
  });
});
