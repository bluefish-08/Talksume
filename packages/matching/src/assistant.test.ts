import type { Job, Profile } from "@talksume/core";
import { createDb, type DbHandle, JobRepo, migrate, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeProfile } from "./fixtures.ts";
import type { StructuredLlm } from "./rerank.ts";
import { createMatchingService } from "./service.ts";

let handle: DbHandle;

const job = (sourceJobId: string, over: Partial<Job>): Job => ({
  id: `demo:${sourceJobId}`,
  source: "demo",
  sourceJobId,
  company: "示例公司",
  title: "岗位",
  cities: ["上海"],
  jobType: "internship",
  jdText: "",
  tags: [],
  fetchedAt: new Date("2026-10-01"),
  ...over,
});

const JOBS = [
  job("1", {
    company: "星河科技",
    title: "后端开发实习生",
    jdText: "负责后端服务开发。要求熟悉 Java、Spring Boot、MySQL、Redis，有高并发项目经验优先。",
    tags: ["Java", "后端"],
  }),
  job("2", {
    company: "云帆网络",
    title: "Java 后台开发实习",
    cities: ["杭州"],
    jdText: "参与后台系统开发，熟悉 Java 与 MySQL，了解 Kafka。",
    tags: ["Java"],
  }),
  job("3", {
    company: "北辰数据",
    title: "前端开发实习生",
    jdText: "使用 React、TypeScript 开发数据可视化页面。",
    tags: ["React"],
  }),
  job("4", {
    company: "青鸟互娱",
    title: "游戏策划",
    cities: ["深圳"],
    jobType: "campus",
    jdText: "负责游戏系统与数值策划，热爱游戏。",
  }),
];

beforeAll(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  await new JobRepo(handle.db).upsertMany(JOBS);
});
afterAll(() => handle.close());

async function newUser(profile?: Profile): Promise<string> {
  const [u] = await handle.db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@t.local` })
    .returning();
  if (!u) throw new Error("user");
  if (profile) await handle.db.insert(schema.profiles).values({ userId: u.id, data: profile });
  return u.id;
}

const liMing = () =>
  makeProfile({
    basics: { name: "李明" },
    skills: ["Java", "MySQL", "Redis", "Spring Boot"].map((name, i) => ({ id: `s${i}`, name })),
    intention: { roles: ["后端开发"], cities: ["上海", "杭州"], jobType: "internship" },
  });

const matchCount = async (userId: string) =>
  (await handle.db.select().from(schema.matchResults).where(eq(schema.matchResults.userId, userId))).length;

describe("对话里的岗位推荐", () => {
  const service = () => createMatchingService(handle.db, { llm: null, embedder: null, minScore: 0 });

  it("画像还没落库时按传入的画像匹配并写入推荐，可按城市收窄", async () => {
    const userId = await newUser();
    const r = await service().recommendFor(userId, liMing(), { limit: 3 });
    expect(r.items[0]?.job.company).toBe("星河科技");
    expect(r.items.every((i) => i.job.jobType === "internship")).toBe(true);
    expect(await matchCount(userId)).toBeGreaterThan(0);

    const hz = await service().recommendFor(userId, liMing(), { city: "杭州", limit: 3 });
    expect(hz.items.map((i) => i.job.company)).toEqual(["云帆网络"]);
  });

  it("推荐没过期时直接复用，画像变了才重新匹配", async () => {
    const profile = liMing();
    const userId = await newUser(profile);
    await service().recommendFor(userId, profile, { limit: 3 });
    const [first] = await handle.db
      .select({ createdAt: schema.matchResults.createdAt })
      .from(schema.matchResults)
      .where(eq(schema.matchResults.userId, userId));

    await service().recommendFor(userId, profile, { limit: 3 });
    const [again] = await handle.db
      .select({ createdAt: schema.matchResults.createdAt })
      .from(schema.matchResults)
      .where(eq(schema.matchResults.userId, userId));
    expect(again?.createdAt.getTime()).toBe(first?.createdAt.getTime());

    const changed = {
      ...profile,
      intention: { ...profile.intention, cities: ["深圳"], jobType: "campus" as const },
    };
    const r = await service().recommendFor(userId, changed, { limit: 3 });
    expect(r.items.map((i) => i.job.company)).toContain("青鸟互娱");
  });

  it("方向关键词按岗位大类收窄，「后端」也能命中「后台」", async () => {
    const userId = await newUser();
    const r = await service().recommendFor(userId, liMing(), { keyword: "后端", limit: 5 });
    expect(r.items.map((i) => i.job.company).sort()).toEqual(["云帆网络", "星河科技"]);
  });

  it("没有符合条件的推荐时给出提示", async () => {
    const userId = await newUser();
    const r = await service().recommendFor(userId, liMing(), { keyword: "算法", limit: 3 });
    expect(r.items).toEqual([]);
    expect(r.hint).toContain("没有符合这些条件的");
  });
});

describe("对话里的岗位搜索与解读", () => {
  type Req = Parameters<StructuredLlm["completeStructured"]>[0];

  it("搜索不受推荐门槛限制，并按画像现算匹配度", async () => {
    const userId = await newUser();
    const service = createMatchingService(handle.db, { llm: null, embedder: null });
    const r = await service.searchFor(userId, liMing(), { q: "策划", limit: 3 });
    expect(r.total).toBe(1);
    expect(r.items[0]?.job.company).toBe("青鸟互娱");
    expect(r.items[0]?.score).toBeGreaterThanOrEqual(0);
    expect(r.items[0]?.dims.skills).toBeDefined();
    expect(await matchCount(userId)).toBe(0);
  });

  it("解读时现场生成报告，硬性条件不符会标出来", async () => {
    const prompts: string[] = [];
    const llm: StructuredLlm = {
      completeStructured: async <T>(req: Req) => {
        prompts.push(req.prompt ?? "");
        return {
          value: req.validate({
            summary: "技能对口",
            strengths: ["熟悉 Java"],
            gaps: ["缺少高并发项目"],
          }) as T,
          text: "",
          model: "fake",
        };
      },
    };
    const userId = await newUser();
    const service = createMatchingService(handle.db, { llm, embedder: null });
    const r = await service.explainFor(userId, liMing(), "demo:1");
    expect(r?.report).toEqual({ summary: "技能对口", strengths: ["熟悉 Java"], gaps: ["缺少高并发项目"] });
    expect(r?.blocked).toBeUndefined();
    expect(prompts[0]).toContain("星河科技");

    const far = await service.explainFor(userId, liMing(), "demo:4");
    expect(far?.blocked).toMatch(/^求职类型不符/);
    expect(await service.explainFor(userId, liMing(), "demo:nope")).toBeNull();
  });

  it("推荐没过期且已有报告时直接复用，不再调用模型", async () => {
    let calls = 0;
    const llm: StructuredLlm = {
      completeStructured: async <T>(req: Req) => {
        calls++;
        return {
          value: req.validate({ summary: "旧报告", strengths: [], gaps: [] }) as T,
          text: "",
          model: "fake",
        };
      },
    };
    const profile = liMing();
    const userId = await newUser(profile);
    const service = createMatchingService(handle.db, { llm, embedder: null, rerankTopN: 1 });
    await (await service.refresh(userId)).done;
    const before = calls;
    const r = await service.explainFor(userId, profile, "demo:1");
    expect(r?.report?.summary).toBe("旧报告");
    expect(calls).toBe(before);
  });
});
