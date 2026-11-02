import { type Job, Profile } from "@talksume/core";
import { createDb, type DbHandle, JobRepo, migrate, schema } from "@talksume/db";
import { dedupeJobs } from "@talksume/matching";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerDevAuth } from "../auth.ts";
import { jobsBrowseRoutes } from "./jobs-browse.ts";
import { createMatchingRoutes } from "./matching.ts";

let handle: DbHandle;
let app: FastifyInstance;
let headers: Record<string, string>;

const JD = "负责后端服务开发，熟悉 Java、MySQL、Redis，参与高并发系统设计。";
const job = (id: string, over: Partial<Job> = {}): Job => ({
  id: `fake:${id}`,
  source: "fake",
  sourceJobId: id,
  company: "星河科技",
  title: "Java 后端开发",
  cities: ["上海"],
  jobType: "internship",
  jdText: JD,
  tags: [],
  fetchedAt: new Date("2026-10-30"),
  ...over,
});

const JOBS = [
  job("a1", { postedAt: new Date("2026-10-01") }),
  job("a2", { postedAt: new Date("2026-10-05"), cities: ["北京"] }),
  job("a3", { jobType: "campus" }),
  job("b1", { company: "青柚数据", title: "后端开发实习生", jdText: `${JD}熟悉 Spring Boot。` }),
  job("b2", {
    company: "青柚数据",
    title: "后端开发实习生",
    jdText: `${JD} 熟悉 Spring Boot。`,
    cities: ["杭州"],
  }),
  job("c", { company: "北辰云", title: "Java 开发实习", jdText: `${JD}有分布式经验优先。` }),
];

async function json(method: "GET" | "POST", url: string) {
  const res = await app.inject({ method, url, headers });
  return { status: res.statusCode, body: res.json() };
}

beforeAll(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  await new JobRepo(handle.db).upsertMany(JOBS);
  app = Fastify();
  registerDevAuth(app, handle.db);
  const deps = { edition: "cloud" as const, version: "t", db: handle.db };
  jobsBrowseRoutes(app, deps);
  createMatchingRoutes({ llm: null, embedder: null })(app, deps);

  const [u] = await handle.db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@t.local` })
    .returning();
  if (!u) throw new Error("user");
  const data = Profile.parse({
    education: [{ id: "e", school: "某大学", degree: "bachelor", major: "计算机科学与技术" }],
    skills: ["Java", "MySQL", "Redis"].map((name, i) => ({ id: `s${i}`, name })),
    intention: { roles: ["后端开发工程师"], cities: ["上海"], jobType: "internship" },
  });
  await handle.db.insert(schema.profiles).values({ userId: u.id, data });
  headers = { "x-talksume-user": u.id };

  // 先按未去重的库生成一轮推荐，模拟回填前已存在的匹配结果
  expect((await json("POST", "/api/v1/matches/refresh")).status).toBe(200);
  await dedupeJobs(handle.db);
}, 60_000);
afterAll(() => handle.close());

const ids = (items: { id: string }[]) => items.map((j) => j.id).sort();

describe("重复发布的岗位", () => {
  it("浏览列表、总数和分面只算规范岗位，城市筛选能命中合并来的城市", async () => {
    const list = await json("GET", "/api/v1/browse/jobs");
    expect(ids(list.body.items.map((i: { job: { id: string } }) => i.job))).toEqual([
      "fake:a2",
      "fake:a3",
      "fake:b1",
      "fake:c",
    ]);
    expect(list.body.total).toBe(4);
    const a2 = list.body.items.find((i: { job: { id: string } }) => i.job.id === "fake:a2");
    expect(a2.job.cities).toEqual(["北京", "上海"]);

    const facets = await json("GET", "/api/v1/browse/facets");
    expect(facets.body.company).toEqual(
      expect.arrayContaining([
        { value: "星河科技", count: 2 },
        { value: "青柚数据", count: 1 },
      ]),
    );
    expect(facets.body.type).toEqual(
      expect.arrayContaining([
        { value: "internship", count: 3 },
        { value: "campus", count: 1 },
      ]),
    );

    const shanghai = await json("GET", "/api/v1/browse/jobs?city=%E4%B8%8A%E6%B5%B7");
    expect(shanghai.body.items.map((i: { job: { id: string } }) => i.job.id)).toContain("fake:a2");

    const search = await json("GET", "/api/v1/jobs?q=Java");
    expect(ids(search.body.items)).toEqual(["fake:a2", "fake:a3", "fake:b1", "fake:c"]);
  });

  it("推荐不再出现重复，在招总数按去重后计算", async () => {
    const stored = await handle.db.select({ id: schema.matchResults.jobId }).from(schema.matchResults);
    expect(stored.map((r) => r.id)).toContain("fake:a1");
    const stale = await json("GET", "/api/v1/matches?limit=50");
    expect(ids(stale.body.items.map((i: { job: { id: string } }) => i.job))).not.toContain("fake:a1");

    const refresh = await json("POST", "/api/v1/matches/refresh");
    const { jobType, city, degree } = refresh.body.excluded;
    expect(refresh.body.candidates + jobType + city + degree).toBe(4);

    const list = await json("GET", "/api/v1/matches?limit=50");
    const got = ids(list.body.items.map((i: { job: { id: string } }) => i.job));
    expect(got).toEqual(["fake:a2", "fake:b1", "fake:c"]);
    expect(list.body.total).toBe(got.length);
  });

  it("旧 id 的详情和按需匹配都能正常打开", async () => {
    const detail = await json("GET", "/api/v1/jobs/fake%3Aa1");
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id: "fake:a1", cities: ["上海"], status: "open" });

    const match = await json("POST", "/api/v1/browse/jobs/fake%3Ab2/match");
    expect(match.status).toBe(200);
    expect(match.body.jobId).toBe("fake:b2");
  });
});
