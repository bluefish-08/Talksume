import {
  createFauxCore,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { Profile } from "@talksume/core";
import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";
import type { StructuredLlm } from "../polish-llm.ts";

const profile = Profile.parse({
  basics: { name: "李明" },
  experiences: [
    {
      id: "e1",
      kind: "internship",
      company: "云图数据",
      title: "后端开发实习生",
      highlights: [{ title: "缓存优化", detail: "用 Redis 缓存热点数据" }],
    },
  ],
});

let handle: DbHandle;
let userId: string;

beforeEach(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  const [user] = await handle.db
    .insert(schema.users)
    .values({ email: "polish-chat@example.com" })
    .returning();
  userId = user?.id ?? "";
  await handle.db.insert(schema.profiles).values({ userId, data: profile });
});

afterEach(() => handle.close());

function fakePolishLlm() {
  const prompts: string[] = [];
  const llm: StructuredLlm = {
    completeStructured: async <T>(req: Parameters<StructuredLlm["completeStructured"]>[0]) => {
      prompts.push(req.prompt ?? "");
      const items = (req.prompt ?? "")
        .split("\n")
        .slice(1)
        .map((line) => JSON.parse(line) as { id: string; 原文: string })
        .map((item) => ({ id: item.id, text: "基于 Redis 实现热点数据缓存" }));
      const value = req.validate({ items }) as T;
      return { value, text: JSON.stringify(value), model: "fake-polish" };
    },
  };
  return { llm, prompts };
}

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

async function boot(steps: FauxResponseStep[], resumeLlm: StructuredLlm | null = fakePolishLlm().llm) {
  const core = createFauxCore({ models: [{ id: "fake-model" }] });
  core.setResponses(steps);
  const app = buildApp({
    edition: "cloud",
    version: "t",
    db: handle.db,
    resumeLlm,
    llm: {
      models: [{ id: "fake-model", label: "测试模型", hint: "" }],
      resolve: () => ({ streamFn: (m, c, o) => core.streamSimple(m, c, o), model: core.getModel() }),
    },
  });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/conversations",
    headers: { "x-talksume-user": userId },
    payload: { skipGreeting: true },
  });
  return { app, id: created.json().id as string };
}

describe("对话里润色简历", () => {
  it("调用 polish_resume 后推出润色卡片，instruction 进入润色提示词，并随消息落库", async () => {
    const polish = fakePolishLlm();
    const core = createFauxCore({ models: [{ id: "fake-model" }] });
    core.setResponses([
      toolTurn(fauxToolCall("polish_resume", { items: ["云图数据"], instruction: "更专业" })),
      fauxAssistantMessage([fauxText("云图数据这段已经润色好了，你看看卡片。")]),
    ]);
    const app = buildApp({
      edition: "cloud",
      version: "t",
      db: handle.db,
      resumeLlm: polish.llm,
      llm: {
        models: [{ id: "fake-model", label: "测试模型", hint: "" }],
        resolve: () => ({ streamFn: (m, c, o) => core.streamSimple(m, c, o), model: core.getModel() }),
      },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/conversations",
      headers: { "x-talksume-user": userId },
      payload: { skipGreeting: true },
    });
    const id = created.json().id as string;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${id}/messages`,
      headers: { "x-talksume-user": userId },
      payload: { content: "帮我把云图数据那段润色得更专业一点" },
    });
    const events = parseSse(res.body);
    const card = events.find((e) => e.event === "polish")?.data.polish as Record<string, unknown> | undefined;
    expect(card).toMatchObject({ kind: "generation", status: "draft" });
    expect((card?.items as { heading: string }[] | undefined)?.[0]?.heading).toBe("云图数据");
    expect(polish.prompts[0]).toContain("更专业");
    expect(polish.prompts[0]).toContain("云图数据");

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${id}`,
      headers: { "x-talksume-user": userId },
    });
    const messages = detail.json().messages as { polish?: { items: unknown[] } }[];
    expect(messages.at(-1)?.polish?.items).toHaveLength(1);
  });

  it("没配润色模型时不注册润色工具", async () => {
    const { app, id } = await boot([fauxAssistantMessage([fauxText("好的。")])], null);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${id}/messages`,
      headers: { "x-talksume-user": userId },
      payload: { content: "帮我润色一下简历" },
    });
    expect(parseSse(res.body).some((e) => e.event === "polish")).toBe(false);
  });
});
