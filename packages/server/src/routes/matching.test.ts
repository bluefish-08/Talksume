import { fileURLToPath } from "node:url";
import { Profile } from "@talksume/core";
import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { type StructuredLlm, seedJobsIfEmpty } from "@talksume/matching";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";
import { devHeaderIdentity, installIdentity } from "../identity.ts";
import { createMatchingRoutes } from "./matching.ts";

const FIXTURE_JOBS = fileURLToPath(new URL("../../../matching/src/test-fixtures/jobs.jsonl", import.meta.url));

let handle: DbHandle;

beforeAll(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  await seedJobsIfEmpty(handle.db, FIXTURE_JOBS);
});
afterAll(() => handle.close());

function appWith(
  options: Parameters<typeof createMatchingRoutes>[0] = { llm: null, embedder: null, reranker: null },
) {
  const app = Fastify();
  installIdentity(app, devHeaderIdentity(handle.db));
  createMatchingRoutes(options)(app, { edition: "cloud", version: "t", db: handle.db });
  return app;
}

async function userWithProfile(): Promise<{ "x-talksume-user": string }> {
  const [u] = await handle.db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@t.local` })
    .returning();
  if (!u) throw new Error("user");
  const data = Profile.parse({
    education: [{ id: "e", school: "某大学", degree: "bachelor", major: "计算机科学与技术" }],
    skills: ["Java", "MySQL", "Redis"].map((name, i) => ({ id: `s${i}`, name })),
    intention: { roles: ["后端开发工程师"], cities: ["上海", "北京"] },
  });
  await handle.db.insert(schema.profiles).values({ userId: u.id, data });
  return { "x-talksume-user": u.id };
}

const json = async (
  app: FastifyInstance,
  method: "GET" | "POST",
  url: string,
  headers = {},
  payload?: unknown,
) => {
  const res = await app.inject({
    method,
    url,
    headers,
    ...(payload !== undefined && { payload: payload as object }),
  });
  return { status: res.statusCode, body: res.json() };
};

describe("岗位列表与详情", () => {
  it("已注册到 buildApp", async () => {
    const app = buildApp({ edition: "cloud", version: "t", db: handle.db });
    const res = await app.inject({ method: "GET", url: "/api/v1/jobs?pageSize=2" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(2);
  });

  it("搜索、过滤、分页，返回摘要字段", async () => {
    const app = appWith();
    const { status, body } = await json(
      app,
      "GET",
      "/api/v1/jobs?q=算法&city=北京&jobType=internship&page=1&pageSize=5",
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ page: 1, pageSize: 5 });
    expect(body.total).toBeGreaterThan(0);
    const item = body.items[0];
    expect(item).toMatchObject({ jobType: "internship" });
    expect(item.cities).toContain("北京");
    expect(item).toHaveProperty("snippet");
    expect(item).not.toHaveProperty("jdText");

    const company = await json(app, "GET", `/api/v1/jobs?company=${encodeURIComponent("云帆数据")}&pageSize=50`);
    expect(company.body.items.every((j: { company: string }) => j.company === "云帆数据")).toBe(true);
  });

  it("参数非法返回 400", async () => {
    const app = appWith();
    expect((await json(app, "GET", "/api/v1/jobs?jobType=nope")).status).toBe(400);
    expect((await json(app, "GET", "/api/v1/jobs?page=0")).body.error.code).toBe("bad_request");
  });

  it("详情带 JD 全文，ID 含冒号也能访问；不存在返回 404", async () => {
    const app = appWith();
    const list = await json(app, "GET", "/api/v1/jobs?pageSize=1");
    const id = list.body.items[0].id as string;
    const detail = await json(app, "GET", `/api/v1/jobs/${encodeURIComponent(id)}`);
    expect(detail.status).toBe(200);
    expect(detail.body.jdText.length).toBeGreaterThan(20);
    const missing = await json(app, "GET", "/api/v1/jobs/nope");
    expect(missing).toMatchObject({ status: 404, body: { error: { code: "job_not_found" } } });
  });
});

describe("推荐", () => {
  it("没有画像时 refresh 返回 409", async () => {
    const app = appWith();
    const [u] = await handle.db
      .insert(schema.users)
      .values({ email: `${crypto.randomUUID()}@t.local` })
      .returning();
    const res = await json(app, "POST", "/api/v1/matches/refresh", { "x-talksume-user": u?.id ?? "" }, {});
    expect(res).toMatchObject({ status: 409, body: { error: { code: "profile_not_found" } } });
  });

  it("refresh 后 GET /matches 返回带维度证据和岗位摘要的降序列表", async () => {
    const app = appWith();
    const headers = await userWithProfile();
    const refresh = await json(app, "POST", "/api/v1/matches/refresh", headers);
    expect(refresh.status).toBe(200);
    expect(refresh.body).toMatchObject({ rerank: "skipped" });
    expect(refresh.body.count).toBeGreaterThan(5);
    expect(refresh.body.excluded).toHaveProperty("city");

    const list = await json(app, "GET", "/api/v1/matches?limit=3", headers);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(3);
    expect(list.body.total).toBe(refresh.body.count);
    const [a, b] = list.body.items;
    expect(a.score).toBeGreaterThanOrEqual(b.score);
    expect(a.job.title).toBeTruthy();
    expect(Object.keys(a.dims)).toEqual(
      expect.arrayContaining(["skills", "role", "experience", "major", "city"]),
    );
    expect(a.dims.skills.evidence.length).toBeGreaterThan(0);
    expect(a).toMatchObject({ report: {}, feedback: null });
  });

  it("配置了 LLM 时 wait=true 会等报告写完", async () => {
    const llm: StructuredLlm = {
      completeStructured: async <T>(req: Parameters<StructuredLlm["completeStructured"]>[0]) => ({
        value: req.validate({ summary: "很匹配", strengths: ["a"], gaps: ["b"] }) as T,
        text: "",
        model: "fake",
      }),
    };
    const app = appWith({ llm, embedder: null, reranker: null, rerankTopN: 3 });
    const headers = await userWithProfile();
    const refresh = await json(app, "POST", "/api/v1/matches/refresh", headers, { wait: true });
    expect(refresh.body.rerank).toBe("done");
    const list = await json(app, "GET", "/api/v1/matches?limit=5", headers);
    expect(list.body.items.filter((i: { report: { summary?: string } }) => i.report.summary)).toHaveLength(3);
  });
});

describe("报告失败与重试", () => {
  it("报告失败时列表标记 failed，重试接口重新生成；未开启 LLM 返回 503", async () => {
    let healthy = false;
    const llm: StructuredLlm = {
      completeStructured: async <T>(req: Parameters<StructuredLlm["completeStructured"]>[0]) => {
        if (!healthy) throw new Error("timeout");
        return {
          value: req.validate({ summary: "很匹配", strengths: ["a"], gaps: ["b"] }) as T,
          text: "",
          model: "fake",
        };
      },
    };
    const app = appWith({
      llm,
      embedder: null,
      reranker: null,
      rerankTopN: 2,
      rerank: { attempts: 1, retryDelayMs: 0 },
      onError: () => {},
    });
    const headers = await userWithProfile();
    await json(app, "POST", "/api/v1/matches/refresh", headers, { wait: true });
    const [first] = (await json(app, "GET", "/api/v1/matches?limit=2", headers)).body.items;
    expect(first).toMatchObject({ report: {}, reportStatus: "failed" });

    healthy = true;
    const url = `/api/v1/jobs/${encodeURIComponent(first.jobId)}/report`;
    const retry = await json(app, "POST", url, headers, { wait: true });
    expect(retry).toMatchObject({ status: 202, body: { jobId: first.jobId, reportStatus: "done" } });
    const [again] = (await json(app, "GET", "/api/v1/matches?limit=1", headers)).body.items;
    expect(again).toMatchObject({ reportStatus: "ready", report: { summary: "很匹配" } });

    const missing = await json(app, "POST", "/api/v1/jobs/nope/report", headers, {});
    expect(missing.status).toBe(404);
    const off = await json(appWith(), "POST", url, headers, {});
    expect(off).toMatchObject({ status: 503, body: { error: { code: "llm_unavailable" } } });
  });
});

describe("反馈与导入", () => {
  it("提交反馈、校验参数、再 refresh 后同类岗位降权", async () => {
    const app = appWith();
    const headers = await userWithProfile();
    await json(app, "POST", "/api/v1/matches/refresh", headers);
    const before = (await json(app, "GET", "/api/v1/matches?limit=100", headers)).body.items;
    const top = before[0];

    const bad = await json(app, "POST", `/api/v1/jobs/${encodeURIComponent(top.jobId)}/feedback`, headers, {
      signal: "meh",
    });
    expect(bad.status).toBe(400);
    const missing = await json(app, "POST", "/api/v1/jobs/nope/feedback", headers, { signal: "like" });
    expect(missing.status).toBe(404);

    const ok = await json(app, "POST", `/api/v1/jobs/${encodeURIComponent(top.jobId)}/feedback`, headers, {
      signal: "irrelevant",
      reason: "方向不对",
    });
    expect(ok).toMatchObject({ status: 201, body: { signal: "irrelevant", jobId: top.jobId } });

    await json(app, "POST", "/api/v1/matches/refresh", headers);
    const after = (await json(app, "GET", "/api/v1/matches?limit=100", headers)).body.items;
    const now = after.find((i: { jobId: string }) => i.jobId === top.jobId);
    expect(now.score).toBeLessThan(top.score);
    expect(now.feedback).toBe("irrelevant");
    expect(after[0].jobId).not.toBe(top.jobId);
  });

  it("导入 JD：太短 400，正常 201 并返回匹配结果", async () => {
    const app = appWith();
    const headers = await userWithProfile();
    expect((await json(app, "POST", "/api/v1/jobs/import", headers, { text: "太短" })).status).toBe(400);
    expect(
      (await json(app, "POST", "/api/v1/jobs/import", headers, { text: "x".repeat(30), url: "not-a-url" }))
        .status,
    ).toBe(400);

    const text =
      "岗位名称：Java后端开发实习生\n公司：示例科技\n工作地点：上海\n熟悉Java、MySQL，计算机相关专业本科及以上。";
    const res = await json(app, "POST", "/api/v1/jobs/import", headers, { text });
    expect(res.status).toBe(201);
    expect(res.body.job).toMatchObject({
      source: "user_import",
      title: "Java后端开发实习生",
      company: "示例科技",
    });
    expect(res.body.match.score).toBeGreaterThan(50);
    const detail = await json(app, "GET", `/api/v1/jobs/${encodeURIComponent(res.body.job.id)}`, headers);
    expect(detail.status).toBe(200);
  });
});
