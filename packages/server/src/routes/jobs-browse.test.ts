import { type Job, Profile } from "@talksume/core";
import { createDb, type DbHandle, JobRepo, migrate, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";
import { devHeaderIdentity, installIdentity } from "../identity.ts";
import { jobsBrowseRoutes } from "./jobs-browse.ts";

let handle: DbHandle;
let app: FastifyInstance;

const COMPANIES = ["星河科技", "青柚数据", "北辰云"] as const;
const CITIES = ["上海", "北京", "杭州"] as const;
const TYPES = ["internship", "campus", "experienced"] as const;
const DEGREES = [undefined, "bachelor", "master"] as const;

function job(i: number): Job {
  return {
    id: `fake:${i}`,
    source: "fake",
    sourceJobId: String(i),
    company: COMPANIES[Math.floor(i / 3) % 3] as string,
    title: i % 4 === 0 ? `Java 后端开发 ${i}` : `数据分析师 ${i}`,
    cities: i % 5 === 0 ? ["上海", "杭州"] : [CITIES[Math.floor(i / 2) % 3] as string],
    jobType: TYPES[i % 3],
    ...(DEGREES[Math.floor(i / 9) % 3] && { degree: DEGREES[Math.floor(i / 9) % 3] }),
    jdText:
      i % 4 === 0 ? "负责后端服务开发，熟悉 Java、MySQL、Redis。" : "负责业务数据分析，熟悉 SQL、Excel。",
    tags: [],
    postedAt: new Date(Date.UTC(2026, 9, 1) + i * 3600_000),
    fetchedAt: new Date("2026-10-30"),
  };
}

const JOBS = Array.from({ length: 45 }, (_, i) => job(i));

beforeAll(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  const repo = new JobRepo(handle.db);
  await repo.upsertMany([
    ...JOBS,
    { ...job(100), id: "fake:closed", sourceJobId: "closed", title: "已关闭岗位" },
    {
      ...job(101),
      id: "user_import:someone:x",
      source: "user_import",
      sourceJobId: "someone:x",
      title: "别人导入的 JD",
    },
  ]);
  await handle.db.update(schema.jobs).set({ status: "closed" }).where(eq(schema.jobs.id, "fake:closed"));
  app = Fastify();
  installIdentity(app, devHeaderIdentity(handle.db));
  jobsBrowseRoutes(app, { edition: "cloud", version: "t", db: handle.db });
}, 60_000);
afterAll(() => handle.close());

async function newUser(profile?: Record<string, unknown>) {
  const [u] = await handle.db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@t.local` })
    .returning();
  if (!u) throw new Error("user");
  if (profile) await handle.db.insert(schema.profiles).values({ userId: u.id, data: Profile.parse(profile) });
  return { id: u.id, headers: { "x-talksume-user": u.id } };
}

const internProfile = {
  education: [{ id: "e", school: "某大学", degree: "bachelor", major: "计算机科学与技术" }],
  skills: ["Java", "MySQL", "Redis"].map((name, i) => ({ id: `s${i}`, name })),
  intention: { roles: ["后端开发工程师"], cities: ["上海"], jobType: "internship" },
};

async function get(url: string, headers = {}) {
  const res = await app.inject({ method: "GET", url, headers });
  return { status: res.statusCode, body: res.json() };
}

async function post(url: string, headers = {}) {
  const res = await app.inject({ method: "POST", url, headers, payload: {} });
  return { status: res.statusCode, body: res.json() };
}

describe("全部岗位列表", () => {
  it("已注册到 buildApp", async () => {
    const full = buildApp({ edition: "cloud", version: "t", db: handle.db });
    const res = await full.inject({ method: "GET", url: "/api/v1/browse/jobs?limit=1" });
    expect(res.statusCode).toBe(200);
  });

  it("按发布时间倒序分页，翻到底 nextOffset 为 null，不含已关闭和别人导入的岗位", async () => {
    const seen: string[] = [];
    let offset: number | null = 0;
    let total = 0;
    while (offset !== null) {
      const { status, body } = await get(`/api/v1/browse/jobs?limit=20&offset=${offset}`);
      expect(status).toBe(200);
      total = body.total;
      seen.push(...body.items.map((i: { job: { id: string } }) => i.job.id));
      offset = body.nextOffset;
    }
    expect(total).toBe(JOBS.length);
    expect(seen).toHaveLength(JOBS.length);
    expect(new Set(seen).size).toBe(JOBS.length);
    expect(seen[0]).toBe("fake:44");
    expect(seen).not.toContain("fake:closed");
    expect(seen).not.toContain("user_import:someone:x");
  });

  it("公司、城市、类型、学历多选筛选，total 跟随筛选", async () => {
    const { body } = await get(
      `/api/v1/browse/jobs?limit=50&company=${encodeURIComponent("星河科技,北辰云")}&type=internship`,
    );
    const expected = JOBS.filter(
      (j) => (j.company === "星河科技" || j.company === "北辰云") && j.jobType === "internship",
    );
    expect(body.total).toBe(expected.length);
    expect(body.items.map((i: { job: { id: string } }) => i.job.id).sort()).toEqual(
      expected.map((j) => j.id).sort(),
    );

    const city = await get(`/api/v1/browse/jobs?limit=50&city=${encodeURIComponent("杭州")}`);
    expect(city.body.total).toBe(JOBS.filter((j) => j.cities.includes("杭州")).length);

    const anyDegree = await get("/api/v1/browse/jobs?limit=50&degree=any");
    expect(anyDegree.body.total).toBe(JOBS.filter((j) => !j.degree).length);
  });

  it("关键词搜索标题、公司和 JD，通配符按字面匹配", async () => {
    const title = await get(`/api/v1/browse/jobs?q=${encodeURIComponent("后端")}`);
    expect(title.body.total).toBe(JOBS.filter((j) => j.title.includes("后端")).length);
    const company = await get(`/api/v1/browse/jobs?q=${encodeURIComponent("青柚")}`);
    expect(company.body.total).toBe(15);
    const jd = await get(`/api/v1/browse/jobs?q=${encodeURIComponent("Excel")}`);
    expect(jd.body.total).toBe(JOBS.filter((j) => j.jdText.includes("Excel")).length);
    expect((await get("/api/v1/browse/jobs?q=%25")).body.total).toBe(0);
  });

  it("按匹配度排序时推荐结果里的岗位排在前面并带分数", async () => {
    const user = await newUser(internProfile);
    await handle.db.insert(schema.matchResults).values([
      { userId: user.id, jobId: "fake:3", score: 80 },
      { userId: user.id, jobId: "fake:9", score: 60 },
    ]);
    const { body } = await get("/api/v1/browse/jobs?sort=match&limit=3", user.headers);
    expect(body.items.map((i: { job: { id: string }; score: number | null }) => [i.job.id, i.score])).toEqual(
      [
        ["fake:3", 80],
        ["fake:9", 60],
        ["fake:44", null],
      ],
    );
  });

  it("参数非法返回 400", async () => {
    expect((await get("/api/v1/browse/jobs?type=nope")).status).toBe(400);
    expect((await get("/api/v1/browse/jobs?sort=hot")).status).toBe(400);
    expect((await get("/api/v1/browse/jobs?limit=500")).body.error.code).toBe("bad_request");
  });
});

describe("筛选项统计", () => {
  it("每个维度的数量按其他维度的筛选统计，不受自身选择影响", async () => {
    const all = await get("/api/v1/browse/facets");
    expect(all.status).toBe(200);
    expect(all.body.company).toEqual(
      expect.arrayContaining(COMPANIES.map((value) => ({ value, count: 15 }))),
    );
    expect(all.body.degree).toEqual(
      expect.arrayContaining([{ value: "any", count: JOBS.filter((j) => !j.degree).length }]),
    );

    const picked = await get(`/api/v1/browse/facets?company=${encodeURIComponent("星河科技")}`);
    expect(picked.body.company).toHaveLength(3);
    const types = Object.fromEntries(
      picked.body.type.map((x: { value: string; count: number }) => [x.value, x.count]),
    );
    const mine = JOBS.filter((j) => j.company === "星河科技");
    expect(types).toEqual({
      internship: mine.filter((j) => j.jobType === "internship").length,
      campus: mine.filter((j) => j.jobType === "campus").length,
      experienced: mine.filter((j) => j.jobType === "experienced").length,
    });
    const shanghai = picked.body.city.find((x: { value: string }) => x.value === "上海");
    expect(shanghai.count).toBe(
      JOBS.filter((j) => j.company === "星河科技" && j.cities.includes("上海")).length,
    );
  });
});

describe("按需匹配", () => {
  const special = (id: string, over: Partial<Job>): Job => ({
    ...job(0),
    id: `fake:${id}`,
    sourceJobId: id,
    jobType: "internship",
    cities: ["上海"],
    ...over,
  });

  beforeAll(async () => {
    await new JobRepo(handle.db).upsertMany([
      special("fit", { title: "Java 后端开发实习生", jdText: "负责后端服务开发，熟悉 Java、MySQL、Redis。" }),
      special("social", { jobType: "experienced" }),
      special("city", { cities: ["北京"] }),
      special("degree", { degree: "master" }),
      special("low", { title: "新媒体运营实习生", jdText: "负责公众号内容策划与活动运营，文字功底好。" }),
    ]);
  });

  it("在推荐结果里的岗位直接返回推荐分数", async () => {
    const user = await newUser(internProfile);
    await handle.db.insert(schema.matchResults).values({ userId: user.id, jobId: "fake:fit", score: 77 });
    const { status, body } = await post("/api/v1/browse/jobs/fake%3Afit/match", user.headers);
    expect(status).toBe(200);
    expect(body).toMatchObject({ recommended: true, match: { jobId: "fake:fit", score: 77 } });
  });

  it("不在推荐里的岗位现场打分，返回各维度但不写入推荐", async () => {
    const user = await newUser(internProfile);
    const { status, body } = await post("/api/v1/browse/jobs/fake%3Afit/match", user.headers);
    expect(status).toBe(200);
    expect(body).toMatchObject({ recommended: false, belowThreshold: false });
    expect(body.excluded).toBeUndefined();
    expect(body.match.score).toBeGreaterThan(50);
    expect(Object.keys(body.match.dims)).toEqual(["skills", "role", "experience", "major", "city"]);
    expect(body.match.dims.skills.evidence.length).toBeGreaterThan(0);
    const stored = await handle.db
      .select()
      .from(schema.matchResults)
      .where(eq(schema.matchResults.userId, user.id));
    expect(stored).toHaveLength(0);
  });

  it("被硬筛选排除的岗位说明原因，仍然给出分数", async () => {
    const user = await newUser(internProfile);
    const type = await post("/api/v1/browse/jobs/fake%3Asocial/match", user.headers);
    expect(type.body.excluded).toEqual({ reason: "jobType", message: "求职类型不同：你想找实习，这是社招" });
    expect(type.body.match.score).toBeTypeOf("number");

    const city = await post("/api/v1/browse/jobs/fake%3Acity/match", user.headers);
    expect(city.body.excluded).toEqual({
      reason: "city",
      message: "城市不在意向内：你的意向城市是上海，这个岗位在北京",
    });

    const degree = await post("/api/v1/browse/jobs/fake%3Adegree/match", user.headers);
    expect(degree.body.excluded).toEqual({
      reason: "degree",
      message: "学历要求更高：你的最高学历是本科，这个岗位要求硕士及以上",
    });
  });

  it("相关度低于推荐门槛时标出来", async () => {
    const user = await newUser(internProfile);
    const { body } = await post("/api/v1/browse/jobs/fake%3Alow/match", user.headers);
    expect(body.excluded).toBeUndefined();
    expect(body.belowThreshold).toBe(true);
  });

  it("没有画像返回 409，岗位不存在或不可见返回 404", async () => {
    const user = await newUser();
    const none = await post("/api/v1/browse/jobs/fake%3Afit/match", user.headers);
    expect(none).toMatchObject({ status: 409, body: { error: { code: "profile_not_found" } } });
    const missing = await post("/api/v1/browse/jobs/nope/match", user.headers);
    expect(missing.status).toBe(404);
    const hidden = await post(
      `/api/v1/browse/jobs/${encodeURIComponent("user_import:someone:x")}/match`,
      user.headers,
    );
    expect(hidden.status).toBe(404);
  });
});

describe("匹配解释", () => {
  it("给出已有和缺失的关键词、必备和加分覆盖、可解释的分数", async () => {
    await new JobRepo(handle.db).upsertMany([
      {
        ...job(0),
        id: "fake:explain",
        sourceJobId: "explain",
        title: "后端开发实习生",
        jdText: "岗位职责：\n1. 负责后端服务开发\n任职要求：\n熟悉 Java、MySQL、Kafka\n加分项：了解 Docker",
      },
    ]);
    const user = await newUser(internProfile);
    const { status, body } = await get("/api/v1/browse/jobs/fake%3Aexplain/explain", user.headers);
    expect(status).toBe(200);
    const e = body.explanation;
    const names = (items: { name: string; status: string }[], st: string) =>
      items.filter((i) => i.status === st).map((i) => i.name);
    expect(names(e.required, "have")).toEqual(expect.arrayContaining(["Java", "MySQL"]));
    expect(names(e.required, "missing")).toContain("Kafka");
    expect(names(e.bonus, "missing")).toContain("Docker");
    expect(e.responsibilities).toEqual(["负责后端服务开发"]);
    expect(e.score).toBeGreaterThan(0);
    expect(e.components.reduce((sum: number, c: { weight: number }) => sum + c.weight, 0)).toBeCloseTo(1, 2);
  });

  it("没有画像返回 409，岗位不可见返回 404", async () => {
    const none = await get("/api/v1/browse/jobs/fake%3Afit/explain", (await newUser()).headers);
    expect(none).toMatchObject({ status: 409 });
    const user = await newUser(internProfile);
    expect((await get("/api/v1/browse/jobs/nope/explain", user.headers)).status).toBe(404);
    const hidden = await get(
      `/api/v1/browse/jobs/${encodeURIComponent("user_import:someone:x")}/explain`,
      user.headers,
    );
    expect(hidden.status).toBe(404);
  });
});
