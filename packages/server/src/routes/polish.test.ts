import { Profile } from "@talksume/core";
import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { devHeaderIdentity, installIdentity } from "../identity.ts";
import type { StructuredLlm } from "../polish-llm.ts";
import { createPolishRoutes } from "./polish.ts";
import { resumeRoutes } from "./resume.ts";

const profile = Profile.parse({
  basics: { name: "李明" },
  projects: [
    {
      id: "p1",
      name: "江城闲置",
      techStack: ["Redis"],
      action: "我用 Redis 搞了个缓存",
      result: "上线后有三百多人用",
      sourceFactIds: ["f1"],
    },
  ],
});

type Rewrite = (original: string, note: string | undefined, call: number) => string;

function fakeLlm(rewrite: Rewrite) {
  const calls: { purpose: string; prompt: string; temperature?: number }[] = [];
  const llm: StructuredLlm = {
    completeStructured: async <T>(req: Parameters<StructuredLlm["completeStructured"]>[0]) => {
      calls.push({
        purpose: req.purpose,
        prompt: req.prompt ?? "",
        ...(req.temperature !== undefined && { temperature: req.temperature }),
      });
      const items = (req.prompt ?? "")
        .split("\n")
        .slice(1)
        .map((line) => JSON.parse(line) as { id: string; 原文: string; 要求?: string })
        .map((item) => ({ id: item.id, text: rewrite(item.原文, item.要求, calls.length) }));
      const value = req.validate({ items }) as T;
      return { value, text: JSON.stringify(value), model: "fake" };
    },
  };
  return { llm, calls };
}

let handle: DbHandle;
let headers: Record<string, string>;

beforeEach(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  const [user] = await handle.db.insert(schema.users).values({ email: "polish@example.com" }).returning();
  await handle.db.insert(schema.profiles).values({ userId: user?.id ?? "", data: profile });
  headers = { "x-talksume-user": user?.id ?? "" };
});

afterEach(() => handle.close());

function appWith(llm: StructuredLlm | null): FastifyInstance {
  const app = Fastify();
  installIdentity(app, devHeaderIdentity(handle.db));
  const deps = { edition: "cloud" as const, version: "t", db: handle.db };
  createPolishRoutes({ llm })(app, deps);
  resumeRoutes(app, deps);
  return app;
}

const call = async (app: FastifyInstance, method: "GET" | "POST", url: string, payload?: object) => {
  const res = await app.inject({ method, url, headers, ...(payload && { payload }) });
  return { status: res.statusCode, body: res.json() };
};

const POLISHED: Record<string, string> = {
  "我用 Redis 搞了个缓存": "基于 Redis 设计缓存层",
  上线后有三百多人用: "上线后服务 300 余名用户",
};

describe("简历润色", () => {
  it("没配模型时 available 为 false，润色返回 503", async () => {
    const app = appWith(null);
    const get = await call(app, "GET", "/api/v1/resume/polish");
    expect(get.body.available).toBe(false);
    expect(get.body.entries).toHaveLength(2);
    expect((await call(app, "POST", "/api/v1/resume/polish")).status).toBe(503);
  });

  it("润色要点、校验通过后可采用，预览用润色文字且 factIds 不变", async () => {
    const { llm, calls } = fakeLlm((original) => POLISHED[original] ?? original);
    const app = appWith(llm);
    const polished = await call(app, "POST", "/api/v1/resume/polish");
    expect(polished.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.purpose).toBe("polish");
    const entries = polished.body.entries as {
      polish: { id: string; suggestion: string; violations: string[] };
    }[];
    expect(entries.map((e) => e.polish.suggestion)).toEqual([
      "基于 Redis 设计缓存层",
      "上线后服务 300 余名用户",
    ]);
    expect(entries.every((e) => e.polish.violations.length === 0)).toBe(true);

    const before = await call(app, "GET", "/api/v1/resume");
    expect(before.body.resume.sections[0].items[0].bullets[0].text).toBe("我用 Redis 搞了个缓存");

    const decided = await call(app, "POST", "/api/v1/resume/polish/decisions", {
      ids: entries.map((e) => e.polish.id),
      action: "accept",
    });
    expect(decided.body).toMatchObject({ updated: 2, rejected: 0 });

    const after = await call(app, "GET", "/api/v1/resume");
    expect(after.body.resume.sections[0].items[0].bullets).toEqual([
      { text: "基于 Redis 设计缓存层", factIds: ["f1"] },
      { text: "上线后服务 300 余名用户", factIds: ["f1"] },
    ]);

    const again = await call(app, "POST", "/api/v1/resume/polish");
    expect(again.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("模型原样返回时不保存为待定建议", async () => {
    const { llm } = fakeLlm((original) => original);
    const app = appWith(llm);
    const res = await call(app, "POST", "/api/v1/resume/polish");
    expect(res.status).toBe(200);
    expect(res.body.entries.every((e: { polish: unknown }) => e.polish === null)).toBe(true);
  });

  it("编造的数字和技术词：重试一次仍不合格就标出违规词且不能采用", async () => {
    const { llm, calls } = fakeLlm((original) =>
      original.includes("Redis")
        ? "基于 Redis 与 Kafka 构建缓存，命中率 95%"
        : (POLISHED[original] ?? original),
    );
    const app = appWith(llm);
    const res = await call(app, "POST", "/api/v1/resume/polish");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.prompt).toContain("Kafka");
    const bad = res.body.entries[0].polish;
    expect(bad.violations.sort()).toEqual(["95", "Kafka"]);
    const decided = await call(app, "POST", "/api/v1/resume/polish/decisions", {
      ids: [bad.id],
      action: "accept",
    });
    expect(decided.body).toMatchObject({ updated: 0, rejected: 1 });
    const resume = await call(app, "GET", "/api/v1/resume");
    expect(resume.body.resume.sections[0].items[0].bullets[0].text).toBe("我用 Redis 搞了个缓存");
  });

  it("重试后合格就用重试结果", async () => {
    const { llm } = fakeLlm((original, note) =>
      original.includes("Redis") && !note ? "基于 Redis 与 Kafka 构建缓存" : (POLISHED[original] ?? original),
    );
    const res = await call(appWith(llm), "POST", "/api/v1/resume/polish");
    expect(res.body.entries[0].polish).toMatchObject({ suggestion: "基于 Redis 设计缓存层", violations: [] });
  });

  it("再改一次：带上一版提示、只改指定要点，已采用的文字在审阅期间仍生效", async () => {
    const { llm, calls } = fakeLlm((original, note) =>
      note ? "使用 Redis 实现缓存" : (POLISHED[original] ?? original),
    );
    const app = appWith(llm);
    const first = await call(app, "POST", "/api/v1/resume/polish");
    const target = first.body.entries[0];
    await call(app, "POST", "/api/v1/resume/polish/decisions", { ids: [target.polish.id], action: "accept" });

    const retry = await call(app, "POST", "/api/v1/resume/polish", {
      targets: [{ itemKey: target.itemKey, sourceHash: target.sourceHash }],
    });
    expect(calls[1]?.prompt).toContain("换一种写法");
    expect(calls[1]?.prompt).not.toContain("三百多人");
    expect(calls[1]?.temperature).toBeGreaterThan(0.5);
    expect(retry.body.entries[0].polish).toMatchObject({
      suggestion: "使用 Redis 实现缓存",
      accepted: "基于 Redis 设计缓存层",
      status: "pending",
    });
    const resume = await call(app, "GET", "/api/v1/resume");
    expect(resume.body.resume.sections[0].items[0].bullets[0].text).toBe("基于 Redis 设计缓存层");

    await call(app, "POST", "/api/v1/resume/polish/decisions", {
      ids: [target.polish.id],
      action: "dismiss",
    });
    const kept = await call(app, "GET", "/api/v1/resume/polish");
    expect(kept.body.entries[0].polish).toMatchObject({
      status: "accepted",
      accepted: "基于 Redis 设计缓存层",
    });

    await call(app, "POST", "/api/v1/resume/polish/decisions", { ids: [target.polish.id], action: "revert" });
    const reverted = await call(app, "GET", "/api/v1/resume");
    expect(reverted.body.resume.sections[0].items[0].bullets[0].text).toBe("我用 Redis 搞了个缓存");
  });

  it("原文变了：润色失效回退原文，并标记可重新润色", async () => {
    const { llm } = fakeLlm((original) =>
      original.includes("限流") ? "基于 Redis 实现缓存与限流" : (POLISHED[original] ?? original),
    );
    const app = appWith(llm);
    const first = await call(app, "POST", "/api/v1/resume/polish");
    await call(app, "POST", "/api/v1/resume/polish/decisions", {
      ids: first.body.entries.map((e: { polish: { id: string } }) => e.polish.id),
      action: "accept",
    });

    const userId = headers["x-talksume-user"] ?? "";
    const changed = Profile.parse({
      ...profile,
      projects: [{ ...profile.projects[0], action: "我用 Redis 搞了个缓存，还做了限流" }],
    });
    await handle.db.update(schema.profiles).set({ data: changed }).where(eq(schema.profiles.userId, userId));

    const resume = await call(app, "GET", "/api/v1/resume");
    expect(resume.body.resume.sections[0].items[0].bullets.map((b: { text: string }) => b.text)).toEqual([
      "我用 Redis 搞了个缓存，还做了限流",
      "上线后服务 300 余名用户",
    ]);
    const state = await call(app, "GET", "/api/v1/resume/polish");
    expect(state.body.entries.map((e: { stale: boolean; polish: unknown }) => [e.stale, !!e.polish])).toEqual(
      [
        [true, false],
        [false, true],
      ],
    );

    await call(app, "POST", "/api/v1/resume/polish");
    const repolished = await call(app, "GET", "/api/v1/resume/polish");
    expect(repolished.body.entries[0]).toMatchObject({ stale: false, polish: { status: "pending" } });
  });

  it("润色只作用于当前用户", async () => {
    const { llm } = fakeLlm((original) => POLISHED[original] ?? original);
    const app = appWith(llm);
    const first = await call(app, "POST", "/api/v1/resume/polish");
    const [other] = await handle.db.insert(schema.users).values({ email: "other@example.com" }).returning();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/resume/polish/decisions",
      headers: { "x-talksume-user": other?.id ?? "" },
      payload: { ids: [first.body.entries[0].polish.id], action: "accept" },
    });
    expect(res.json()).toMatchObject({ updated: 0 });
  });
});
