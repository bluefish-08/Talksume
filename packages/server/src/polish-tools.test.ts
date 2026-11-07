import { Profile, polishTargets, profileToResume } from "@talksume/core";
import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { devHeaderIdentity, installIdentity } from "./identity.ts";
import type { StructuredLlm } from "./polish-llm.ts";
import { loadPolishRows, savePolishOutcomes } from "./polish-store.ts";
import {
  PolishBusyError,
  polishBusyFor,
  polishIdsForAll,
  polishItemLine,
  storeResumePolisher,
} from "./polish-tools.ts";
import { createPolishRoutes } from "./routes/polish.ts";

const profile = Profile.parse({
  basics: { name: "李明" },
  experiences: [
    {
      id: "e1",
      kind: "internship",
      company: "云图数据",
      title: "后端开发实习生",
      highlights: [
        { title: "缓存优化", detail: "用 Redis 缓存热点数据" },
        { title: "接口优化", detail: "接口响应从 800ms 降到 200ms" },
      ],
    },
    {
      id: "e2",
      kind: "internship",
      company: "校园二手交易平台",
      title: "全栈开发",
      highlights: [{ title: "商品发布", detail: "开发商品发布和检索功能" }],
    },
  ],
});

interface Call {
  prompt: string;
  temperature?: number;
}

function fakeLlm(rewrite: (original: string, prompt: string) => string) {
  const calls: Call[] = [];
  const llm: StructuredLlm = {
    completeStructured: async <T>(req: Parameters<StructuredLlm["completeStructured"]>[0]) => {
      calls.push({
        prompt: req.prompt ?? "",
        ...(req.temperature !== undefined && { temperature: req.temperature }),
      });
      const items = (req.prompt ?? "")
        .split("\n")
        .slice(1)
        .map((line) => JSON.parse(line) as { id: string; 原文: string })
        .map((item) => ({ id: item.id, text: rewrite(item.原文, req.prompt ?? "") }));
      const value = req.validate({ items }) as T;
      return { value, text: JSON.stringify(value), model: "fake" };
    },
  };
  return { llm, calls };
}

let handle: DbHandle;
let userId: string;

beforeEach(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  const [user] = await handle.db
    .insert(schema.users)
    .values({ email: "polish-tools@example.com" })
    .returning();
  userId = user?.id ?? "";
  await handle.db.insert(schema.profiles).values({ userId, data: profile });
});

afterEach(() => handle.close());

describe("storeResumePolisher", () => {
  it("不点名时只润色没有建议的要点，点名时重润色并带上一次的建议", async () => {
    const { llm, calls } = fakeLlm((original) => `基于${original}`);
    const polisher = storeResumePolisher(handle.db, llm, userId);

    const first = await polisher.polish(profile, {});
    expect(first.polished).toBe(3);
    expect(first.card.items.every((item) => item.state === "pending")).toBe(true);
    expect(first.card.items.map((item) => item.heading)).toEqual([
      "云图数据",
      "云图数据",
      "校园二手交易平台",
    ]);
    expect(first.card.items.map((item) => item.number)).toEqual([1, 2, 3]);
    expect(calls[0]?.prompt).toContain("用 Redis 缓存热点数据");
    expect(calls[0]?.prompt).toContain("开发商品发布和检索功能");

    const second = await polisher.polish(profile, { items: ["云图数据"], instruction: "更专业" });
    expect(second.polished).toBe(2);
    expect(second.card.items).toHaveLength(3);
    expect(calls[1]?.prompt).toContain("更专业");
    expect(calls[1]?.prompt).toContain("换一种写法");
    expect(calls[1]?.prompt).toContain("用 Redis 缓存热点数据");
    expect(calls[1]?.prompt).not.toContain("开发商品发布和检索功能");
    expect(calls[1]?.temperature).toBe(0.8);
  });

  it("原样返回不算建议：不落库、不进卡片，all no-op 时卡片为空", async () => {
    const { llm } = fakeLlm((original) => original);
    const polisher = storeResumePolisher(handle.db, llm, userId);
    const outcome = await polisher.polish(profile, { items: ["云图数据"] });
    expect(outcome.polished).toBe(0);
    expect(outcome.noopItems).toEqual([
      { heading: "云图数据", before: "用 Redis 缓存热点数据" },
      { heading: "云图数据", before: "接口响应从 800ms 降到 200ms" },
    ]);
    expect(outcome.card.items).toHaveLength(0);
    expect(await loadPolishRows(handle.db, userId)).toHaveLength(0);
  });

  it("部分原样返回时只保存真正改动的建议，编号从 1 开始", async () => {
    const { llm } = fakeLlm((original) =>
      original.includes("Redis") ? original : "优化接口响应，从 800ms 降到 200ms",
    );
    const polisher = storeResumePolisher(handle.db, llm, userId);
    const outcome = await polisher.polish(profile, { items: ["云图数据"] });
    expect(outcome.polished).toBe(1);
    expect(outcome.noopItems).toEqual([{ heading: "云图数据", before: "用 Redis 缓存热点数据" }]);
    expect(outcome.card.items).toHaveLength(1);
    expect(outcome.card.items[0]).toMatchObject({ number: 1, before: "接口响应从 800ms 降到 200ms" });
    expect(await loadPolishRows(handle.db, userId)).toHaveLength(1);
  });

  it("点名不存在的条目时返回可用标题，不落库", async () => {
    const { llm } = fakeLlm((original) => original);
    const polisher = storeResumePolisher(handle.db, llm, userId);
    const outcome = await polisher.polish(profile, { items: ["不存在的公司"] });
    expect(outcome.polished).toBe(0);
    expect(outcome.unknownItems).toEqual(["不存在的公司"]);
    expect(outcome.headings).toEqual(["云图数据", "校园二手交易平台"]);
    expect(await loadPolishRows(handle.db, userId)).toHaveLength(0);
  });

  it("all=accept 只采用待定且没被拦下的建议，被拦下的保持待定", async () => {
    const targets = polishTargets(profileToResume(profile));
    await savePolishOutcomes(
      handle.db,
      userId,
      targets.map((target, i) => ({
        target,
        text: `${target.text}（改写）`,
        violations: i === 1 ? ["主导"] : [],
        model: "fake",
      })),
    );
    const { llm } = fakeLlm((original) => original);
    const polisher = storeResumePolisher(handle.db, llm, userId);

    const rowsBefore = await loadPolishRows(handle.db, userId);
    const nonBlocked = rowsBefore.filter((row) => row.violations.length === 0).map((row) => row.id);
    expect(polishIdsForAll(rowsBefore, "accept").sort()).toEqual(nonBlocked.sort());

    const outcome = await polisher.decide(profile, { all: "accept" });
    expect(outcome.blockedIds).toHaveLength(1);
    expect(outcome.card.items.filter((item) => item.state === "accepted")).toHaveLength(2);
    expect(outcome.card.items.filter((item) => item.blocked)).toHaveLength(1);
    expect(outcome.card.status).toBe("partial");

    const rows = await loadPolishRows(handle.db, userId);
    expect(rows.filter((row) => row.status === "accepted")).toHaveLength(2);
    expect(rows.filter((row) => row.status === "pending")).toHaveLength(1);
    expect(rows.find((row) => row.status === "pending")?.violations).toEqual(["主导"]);
  });

  it("显式 accept 被拦下的 id 也不会被采用", async () => {
    const [target] = polishTargets(profileToResume(profile));
    if (!target) throw new Error("缺少测试数据");
    await savePolishOutcomes(handle.db, userId, [
      { target, text: "主导缓存改造", violations: ["主导"], model: "fake" },
    ]);
    const { llm } = fakeLlm((original) => original);
    const polisher = storeResumePolisher(handle.db, llm, userId);
    const [row] = await loadPolishRows(handle.db, userId);
    if (!row) throw new Error("缺少测试数据");
    const outcome = await polisher.decide(profile, { accept: [row.id] });
    expect(outcome.blockedIds).toEqual([row.id]);
    expect((await loadPolishRows(handle.db, userId))[0]?.status).toBe("pending");
  });

  it("all=dismiss 覆盖待定（含被拦下），all=revert 只改回已采用", async () => {
    const targets = polishTargets(profileToResume(profile));
    await savePolishOutcomes(
      handle.db,
      userId,
      targets.map((target, i) => ({
        target,
        text: `${target.text}（改写）`,
        violations: i === 1 ? ["主导"] : [],
        model: "fake",
      })),
    );
    const { llm } = fakeLlm((original) => original);
    const polisher = storeResumePolisher(handle.db, llm, userId);

    await polisher.decide(profile, { all: "accept" });
    await polisher.decide(profile, { all: "dismiss" });
    const dismissed = await loadPolishRows(handle.db, userId);
    expect(dismissed.every((row) => row.status !== "pending")).toBe(true);
    expect(dismissed.filter((row) => row.status === "dismissed")).toHaveLength(1);

    await polisher.decide(profile, { all: "revert" });
    const rows = await loadPolishRows(handle.db, userId);
    expect(rows.every((row) => row.accepted === null)).toBe(true);
  });

  it("busy guard 覆盖对话工具，并和 REST 路由共用同一个集合", async () => {
    const { llm } = fakeLlm((original) => original);
    const busy = new Set([userId]);
    const polisher = storeResumePolisher(handle.db, llm, userId, busy);
    await expect(polisher.polish(profile, {})).rejects.toBeInstanceOf(PolishBusyError);

    const app = Fastify();
    installIdentity(app, devHeaderIdentity(handle.db));
    createPolishRoutes({ llm, busy })(app, { edition: "cloud", version: "t", db: handle.db });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/resume/polish",
      headers: { "x-talksume-user": userId },
      payload: {},
    });
    expect(res.statusCode).toBe(409);

    polishBusyFor(handle.db).add(userId);
    const shared = storeResumePolisher(handle.db, llm, userId);
    await expect(shared.polish(profile, {})).rejects.toBeInstanceOf(PolishBusyError);
    const sharedApp = Fastify();
    installIdentity(sharedApp, devHeaderIdentity(handle.db));
    createPolishRoutes({ llm })(sharedApp, { edition: "cloud", version: "t", db: handle.db });
    const sharedRes = await sharedApp.inject({
      method: "POST",
      url: "/api/v1/resume/polish",
      headers: { "x-talksume-user": userId },
      payload: {},
    });
    expect(sharedRes.statusCode).toBe(409);
    polishBusyFor(handle.db).delete(userId);
  });

  it("工具结果行格式和卡片编号一致", async () => {
    const { llm } = fakeLlm((original) => `基于${original}`);
    const polisher = storeResumePolisher(handle.db, llm, userId);
    const outcome = await polisher.polish(profile, {});
    const [line] = outcome.lines ?? [];
    expect(line).toMatch(/^- 1\. 云图数据：「.+」→「.+」 \[.+\]：待定$/);
    const [item] = outcome.card.items;
    if (!item) throw new Error("缺少测试数据");
    expect(polishItemLine(item)).toBe(line);
  });
});
