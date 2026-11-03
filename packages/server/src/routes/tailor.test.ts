import {
  createFauxCore,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { type Job, Profile, type ResumeContent, type TailorChange } from "@talksume/core";
import { createDb, type DbHandle, JobRepo, migrate, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AppDeps, buildApp } from "../app.ts";
import type { StructuredLlm } from "../polish-llm.ts";

// biome-ignore lint/suspicious/noExplicitAny: 测试里的响应体不做类型约束
type Json = any;

const profile = Profile.parse({
  basics: { name: "李明", email: "liming@example.com" },
  education: [{ id: "e1", school: "江城大学", degree: "bachelor", major: "软件工程", sourceFactIds: ["f0"] }],
  experiences: [
    {
      id: "x1",
      kind: "internship",
      company: "星河科技",
      title: "后端开发实习生",
      techStack: ["Java", "MySQL"],
      highlights: [
        { title: "订单查询", detail: "负责订单查询接口开发" },
        { title: "缓存优化", detail: "用 Redis 给热点数据加缓存，接口耗时从 200ms 降到 80ms" },
      ],
      sourceFactIds: ["f1"],
    },
  ],
  projects: [
    { id: "p1", name: "江城闲置", techStack: ["Vue"], action: "做了前端页面", sourceFactIds: ["f2"] },
    { id: "p2", name: "校园跑腿", techStack: ["Go"], action: "用 Go 写了后端接口", sourceFactIds: ["f3"] },
  ],
  skills: [
    { id: "s1", name: "Vue", sourceFactIds: ["f4"] },
    { id: "s2", name: "Java", sourceFactIds: ["f4"] },
    { id: "s3", name: "Redis", sourceFactIds: ["f4"] },
  ],
});

const job = (id: string, over: Partial<Job>): Job => ({
  id,
  source: "demo",
  sourceJobId: id,
  company: "示例公司",
  title: "岗位",
  cities: ["上海"],
  jobType: "campus",
  jdText: "",
  tags: [],
  fetchedAt: new Date("2026-10-01"),
  ...over,
});

const MEITUAN = "demo:mt1";
const OTHER = "demo:yf1";

const ORDER_TEXT = "负责订单查询接口开发";
const CACHE_TEXT = "用 Redis 给热点数据加缓存，接口耗时从 200ms 降到 80ms";
const CACHE_TAILORED = "基于 Redis 为热点数据加缓存，接口耗时从 200ms 降到 80ms";
const FABRICATED = "负责订单查询接口开发，支撑高并发场景，QPS 提升 50%";

const idOf = (prompt: string, text: string) =>
  new RegExp(`\\[(b\\d+)\\] ${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(prompt)?.[1] ?? "missing";
const itemOf = (prompt: string, heading: string) =>
  new RegExp(`\\[(i\\d+)\\] ${heading}`).exec(prompt)?.[1] ?? "missing";

type Respond = (prompt: string, call: number) => unknown;

function fakeLlm(respond: Respond) {
  const prompts: string[] = [];
  const llm: StructuredLlm = {
    completeStructured: async <T>(req: Parameters<StructuredLlm["completeStructured"]>[0]) => {
      prompts.push(req.prompt ?? "");
      const value = req.validate(respond(req.prompt ?? "", prompts.length)) as T;
      return { value, text: JSON.stringify(value), model: "fake" };
    },
  };
  return { llm, prompts };
}

/** 第一次给出完整定制，含一条编造了数字的改写；retryFix 决定重试时是否改好。 */
const tailorResponder =
  (retryFix: boolean): Respond =>
  (prompt, call) => {
    if (call > 1) {
      return {
        rewrites: [
          { id: idOf(prompt, ORDER_TEXT), text: retryFix ? "负责订单查询相关接口开发" : FABRICATED },
        ],
      };
    }
    return {
      summary: { text: "后端开发实习经历，熟悉 Java 与 Redis 缓存优化", reason: "岗位要求后端开发" },
      rewrites: [
        { id: idOf(prompt, CACHE_TEXT), text: CACHE_TAILORED, reason: "突出缓存经验" },
        { id: idOf(prompt, ORDER_TEXT), text: FABRICATED, reason: "贴合高并发" },
      ],
      bulletOrder: [
        { item: itemOf(prompt, "星河科技"), order: [idOf(prompt, CACHE_TEXT), idOf(prompt, ORDER_TEXT)] },
      ],
      itemOrder: [
        {
          section: "projects",
          order: [itemOf(prompt, "校园跑腿"), itemOf(prompt, "江城闲置")],
          reason: "后端更相关",
        },
      ],
      skillOrder: { names: ["Java", "Redis", "Kafka", "Vue"], reason: "岗位要求 Java" },
    };
  };

let handle: DbHandle;
let app: FastifyInstance;
let userId: string;

beforeAll(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  await new JobRepo(handle.db).upsertMany([
    job(MEITUAN, {
      company: "美团",
      title: "后端开发工程师",
      jdText: "负责高并发后端服务开发，熟悉 Java、Redis、Kafka。",
      tags: ["Java", "高并发"],
    }),
    job(OTHER, { company: "云帆网络", title: "Java 后台开发", jdText: "熟悉 Java 与 MySQL。" }),
  ]);
}, 60_000);

afterAll(() => handle.close());

beforeEach(async () => {
  const [user] = await handle.db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@example.com`, displayName: "李明" })
    .returning();
  userId = user?.id ?? "";
  await handle.db.insert(schema.profiles).values({ userId, data: profile });
});

afterEach(() => app?.close());

async function boot(resumeLlm: StructuredLlm | null, extra: Partial<AppDeps> = {}) {
  app = buildApp({
    edition: "cloud",
    version: "t",
    db: handle.db,
    resumeLlm,
    matching: { llm: null, embedder: null, reranker: null, minScore: 0 },
    ...extra,
  });
  await app.ready();
}

async function call(method: "GET" | "POST" | "DELETE", url: string, payload?: object) {
  const res = await app.inject({
    method,
    url,
    headers: { "x-talksume-user": userId },
    ...(payload && { payload }),
  });
  return {
    status: res.statusCode,
    body: (res.headers["content-type"]?.includes("json") ? res.json() : {}) as Json,
  };
}

const tailorUrl = (jobId: string) => `/api/v1/jobs/${encodeURIComponent(jobId)}/tailoring`;

const allText = (resume: ResumeContent) => JSON.stringify(resume);

describe("按岗位定制简历", () => {
  it("编造的数字和 JD 词被拦下、不能采用；采用后存为该岗位的版本，主简历不变", async () => {
    const { llm, prompts } = fakeLlm(tailorResponder(false));
    await boot(llm);
    const main = (await call("GET", "/api/v1/resume")).body.resume as ResumeContent;

    const generated = await call("POST", tailorUrl(MEITUAN));
    expect(generated.status).toBe(200);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("负责高并发后端服务开发");
    expect(prompts[1]).toContain("50");
    const changes = generated.body.tailoring.changes as TailorChange[];
    expect(changes.map((c) => c.kind).sort()).toEqual(
      ["bullet", "bullet", "bullet_order", "item_order", "skill_order", "summary"].sort(),
    );
    const fabricated = changes.find((c) => c.kind === "bullet" && c.after === FABRICATED);
    expect(fabricated?.violations).toEqual(expect.arrayContaining(["50", "QPS", "高并发"]));
    expect(changes.filter((c) => c !== fabricated).every((c) => c.violations.length === 0)).toBe(true);
    expect(changes.find((c) => c.kind === "skill_order")?.after).toEqual(["Java", "Redis", "Vue"]);

    const onlyBad = await call("POST", `${tailorUrl(MEITUAN)}/adopt`, { changeIds: [fabricated?.id] });
    expect(onlyBad.status).toBe(400);

    const adopted = await call("POST", `${tailorUrl(MEITUAN)}/adopt`, {
      changeIds: changes.map((c) => c.id),
    });
    expect(adopted.status).toBe(200);
    expect(adopted.body).toMatchObject({ adopted: 5, rejected: 1 });
    const versionId = adopted.body.tailoring.adopted.resumeVersionId as string;

    const [version] = await handle.db
      .select()
      .from(schema.resumeVersions)
      .where(eq(schema.resumeVersions.id, versionId));
    expect(version?.targetJobId).toBe(MEITUAN);
    const content = version?.content as ResumeContent;
    expect(allText(content)).not.toContain("50");
    expect(allText(content)).not.toContain("QPS");
    expect(content.basics.summary).toBe("后端开发实习经历，熟悉 Java 与 Redis 缓存优化");
    const sectionOf = (kind: string) => content.sections.find((s) => s.kind === kind);
    expect(sectionOf("experiences")?.items[0]?.bullets.map((b) => b.text)).toEqual([
      CACHE_TAILORED,
      ORDER_TEXT,
    ]);
    expect(sectionOf("experiences")?.items[0]?.bullets[0]?.factIds).toEqual(["f1"]);
    expect(sectionOf("projects")?.items.map((i) => i.heading)).toEqual(["校园跑腿", "江城闲置"]);
    expect(sectionOf("skills")?.items[0]?.bullets[0]?.text).toBe("Java、Redis、Vue");

    expect((await call("GET", "/api/v1/resume")).body.resume).toEqual(main);
    expect(main.basics.summary).toBeUndefined();

    const listed = await call("GET", "/api/v1/tailorings");
    expect(listed.body.items).toMatchObject([
      { jobId: MEITUAN, company: "美团", resumeVersionId: versionId },
    ]);
  });

  it("重试时模型删掉了越界内容就用新的一版", async () => {
    const { llm } = fakeLlm(tailorResponder(true));
    await boot(llm);
    const res = await call("POST", tailorUrl(MEITUAN));
    const changes = res.body.tailoring.changes as TailorChange[];
    expect(changes.find((c) => c.kind === "bullet" && c.before === ORDER_TEXT)).toMatchObject({
      after: "负责订单查询相关接口开发",
      violations: [],
    });
  });

  it("把同一经历的另一条要点并进来视为违规", async () => {
    const { llm } = fakeLlm((prompt) => ({
      rewrites: [{ id: idOf(prompt, CACHE_TEXT), text: `${CACHE_TEXT}，${ORDER_TEXT}` }],
    }));
    await boot(llm);
    const changes = (await call("POST", tailorUrl(MEITUAN))).body.tailoring.changes as TailorChange[];
    expect(changes).toHaveLength(1);
    expect(changes[0]?.violations).toEqual([ORDER_TEXT]);
  });

  it("投递有已采用定制版的岗位默认用定制版，其他岗位用通用版；撤销后回到通用版", async () => {
    const { llm } = fakeLlm(tailorResponder(false));
    await boot(llm);
    const changes = (await call("POST", tailorUrl(MEITUAN))).body.tailoring.changes as TailorChange[];
    const adopted = await call("POST", `${tailorUrl(MEITUAN)}/adopt`, {
      changeIds: changes.map((c) => c.id),
    });
    const versionId = adopted.body.tailoring.adopted.resumeVersionId as string;

    const tailoredApp = await call("POST", "/api/v1/applications", { jobId: MEITUAN });
    expect(tailoredApp.status).toBe(201);
    expect(tailoredApp.body.application).toMatchObject({ resumeVersionId: versionId, resumeTailored: true });

    const generalApp = await call("POST", "/api/v1/applications", { jobId: OTHER });
    expect(generalApp.body.application.resumeTailored).toBe(false);
    expect(generalApp.body.application.resumeVersionId).not.toBe(versionId);
    const [snapshot] = await handle.db
      .select()
      .from(schema.resumeVersions)
      .where(eq(schema.resumeVersions.id, generalApp.body.application.resumeVersionId));
    expect(snapshot?.targetJobId).toBeNull();
    expect(snapshot?.content.basics.summary).toBeUndefined();

    const board = await call("GET", "/api/v1/applications");
    const rows = Object.values(board.body.columns).flat() as {
      job: { id: string };
      resumeTailored: boolean;
    }[];
    expect(rows.find((r) => r.job.id === MEITUAN)?.resumeTailored).toBe(true);

    const revoked = await call("DELETE", `${tailorUrl(MEITUAN)}/adoption`);
    expect(revoked.body.tailoring.adopted).toBeNull();
    expect((await call("GET", "/api/v1/tailorings")).body.items).toEqual([]);
  });

  it("导出可以选定制版，别人的版本 404", async () => {
    const { llm } = fakeLlm(tailorResponder(false));
    await boot(llm);
    const changes = (await call("POST", tailorUrl(MEITUAN))).body.tailoring.changes as TailorChange[];
    const adopted = await call("POST", `${tailorUrl(MEITUAN)}/adopt`, {
      changeIds: changes.map((c) => c.id),
    });
    const versionId = adopted.body.tailoring.adopted.resumeVersionId as string;

    const ok = await app.inject({
      method: "GET",
      url: `/api/v1/resume/export?format=docx&version=${versionId}`,
      headers: { "x-talksume-user": userId },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.rawPayload.subarray(0, 2).toString()).toBe("PK");

    const [stranger] = await handle.db
      .insert(schema.users)
      .values({ email: `${crypto.randomUUID()}@example.com` })
      .returning();
    const foreign = await app.inject({
      method: "GET",
      url: `/api/v1/resume/export?format=docx&version=${versionId}`,
      headers: { "x-talksume-user": stranger?.id ?? "" },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("没配模型返回 503，岗位不存在返回 404", async () => {
    await boot(null);
    expect((await call("GET", tailorUrl(MEITUAN))).body).toMatchObject({ available: false, tailoring: null });
    expect((await call("POST", tailorUrl(MEITUAN))).status).toBe(503);
    expect((await call("GET", tailorUrl("demo:none"))).status).toBe(404);
  });
});

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

async function chat(steps: FauxResponseStep[], resumeLlm: StructuredLlm) {
  const core = createFauxCore({ models: [{ id: "fake-model" }] });
  core.setResponses(steps);
  await boot(resumeLlm, {
    llm: {
      models: [{ id: "fake-model", label: "测试模型", hint: "" }],
      resolve: () => ({ streamFn: (m, c, o) => core.streamSimple(m, c, o), model: core.getModel() }),
    },
  });
  const created = await call("POST", "/api/v1/conversations");
  const id = created.body.id as string;
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${id}/messages`,
    headers: { "x-talksume-user": userId },
    payload: { content: "美团那个帮我定制一下简历" },
  });
  return { id, events: parseSse(res.body) };
}

describe("对话里定制简历", () => {
  it("工具成功：推出定制卡片并随消息落库，模型看到的是草稿、需用户确认", async () => {
    let toolResult = "";
    const { llm } = fakeLlm(tailorResponder(false));
    const { id, events } = await chat(
      [
        toolTurn(fauxToolCall("tailor_resume", { jobId: MEITUAN })),
        (context) => {
          toolResult = JSON.stringify(context.messages.at(-1));
          return fauxAssistantMessage([fauxText("给美团这个岗位生成了定制版，点卡片确认后投递时会用它。")]);
        },
      ],
      llm,
    );
    const card = events.find((e) => e.event === "tailor")?.data.tailor;
    expect(card).toEqual({
      jobId: MEITUAN,
      company: "美团",
      title: "后端开发工程师",
      changes: 5,
      rejected: 1,
    });
    expect(toolResult).toContain("已为「美团 · 后端开发工程师」生成定制版草稿");
    expect(toolResult).toContain("还没有生效");
    expect(toolResult).not.toContain("50%");
    expect(events.some((e) => e.event === "error")).toBe(false);

    const detail = await call("GET", `/api/v1/conversations/${id}`);
    expect(detail.body.messages.at(-1).tailor).toEqual(card);
    const view = await call("GET", tailorUrl(MEITUAN));
    expect(view.body.tailoring.adopted).toBeNull();
    expect((await call("GET", "/api/v1/resume")).body.resume.basics.summary).toBeUndefined();
  });

  it("工具失败：不推卡片，模型被告知没有生成成功", async () => {
    let toolResult = "";
    const llm: StructuredLlm = {
      completeStructured: async () => {
        throw new Error("模型超时");
      },
    };
    const { events } = await chat(
      [
        toolTurn(fauxToolCall("tailor_resume", { jobId: MEITUAN })),
        (context) => {
          toolResult = JSON.stringify(context.messages.at(-1));
          return fauxAssistantMessage([fauxText("这次没定制成功，稍后再试试。")]);
        },
      ],
      llm,
    );
    expect(events.some((e) => e.event === "tailor")).toBe(false);
    expect(toolResult).toContain("定制简历失败");
    expect(toolResult).toContain("不要说已经改好");
    const view = await call("GET", tailorUrl(MEITUAN));
    expect(view.body.tailoring).toBeNull();
  });
});
