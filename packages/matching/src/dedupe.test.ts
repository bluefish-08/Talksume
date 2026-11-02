import type { Job } from "@talksume/core";
import { createDb, type DbHandle, JobRepo, migrate, schema } from "@talksume/db";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type DedupeRow, dedupeJobs, dedupeKey, planDedupe } from "./dedupe.ts";
import { syncCrawledJobs } from "./sync.ts";

const row = (id: string, over: Partial<DedupeRow> = {}): DedupeRow => ({
  id,
  company: "示例科技",
  title: "后台开发",
  jobType: "internship",
  jdText: "负责后台服务开发。\n熟悉 Go 或 C++。",
  cities: ["深圳"],
  postedAt: null,
  ...over,
});

describe("dedupeKey", () => {
  it("忽略空白与全半角差异", () => {
    const a = dedupeKey(row("a"));
    expect(dedupeKey(row("b", { title: "后台 开发", jdText: "负责后台服务开发。 熟悉 Go 或 C++。" }))).toBe(
      a,
    );
    expect(dedupeKey(row("c", { title: "ＡＩ后台开发" }))).toBe(dedupeKey(row("d", { title: "AI后台开发" })));
  });

  it("公司、类型、JD 或标题后缀不同都不算重复，类型缺失不参与", () => {
    const a = dedupeKey(row("a"));
    expect(dedupeKey(row("b", { company: "另一家" }))).not.toBe(a);
    expect(dedupeKey(row("c", { jobType: "campus" }))).not.toBe(a);
    expect(dedupeKey(row("d", { jdText: "负责前端开发" }))).not.toBe(a);
    expect(dedupeKey(row("e", { title: "后台开发（实习）" }))).not.toBe(a);
    expect(dedupeKey(row("f", { jobType: null }))).toBeUndefined();
  });
});

describe("planDedupe", () => {
  it("没有投递时选发布时间最新的，城市取并集", () => {
    const groups = planDedupe(
      [
        row("x:1", { postedAt: new Date("2026-10-01"), cities: ["深圳", "北京"] }),
        row("x:2", { postedAt: new Date("2026-10-05"), cities: ["上海"] }),
        row("x:3", { cities: ["北京", "成都"] }),
      ],
      new Set(),
    );
    expect(groups).toEqual([
      { canonical: "x:2", duplicates: ["x:1", "x:3"], cities: ["上海", "深圳", "北京", "成都"] },
    ]);
  });

  it("被投递引用的优先，发布时间相同时取 id 最小", () => {
    const rows = [row("x:3"), row("x:1"), row("x:2")];
    expect(planDedupe(rows, new Set())[0]?.canonical).toBe("x:1");
    expect(planDedupe(rows, new Set(["x:3"]))[0]?.canonical).toBe("x:3");
  });

  it("同一 JD 的实习和校招保留两条", () => {
    expect(planDedupe([row("x:1"), row("x:2", { jobType: "campus" })], new Set())).toEqual([]);
  });
});

describe("dedupeJobs", () => {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await createDb({ pglite: "memory://" });
    await migrate(handle);
  });
  afterAll(() => handle.close());
  beforeEach(async () => {
    await handle.db.delete(schema.applications);
    await handle.db.delete(schema.jobs);
  });

  const job = (sourceJobId: string, over: Partial<Job> = {}): Job => ({
    id: `crawl:${sourceJobId}`,
    source: "crawl",
    sourceJobId,
    company: "示例科技",
    title: "后台开发",
    cities: ["深圳"],
    jobType: "internship",
    jdText: "负责后台服务开发。",
    tags: [],
    fetchedAt: new Date("2026-11-01T00:00:00Z"),
    ...over,
  });
  const rows = async () =>
    Object.fromEntries(
      (
        await handle.db
          .select({
            id: schema.jobs.id,
            dup: schema.jobs.duplicateOf,
            cities: schema.jobs.cities,
            status: schema.jobs.status,
          })
          .from(schema.jobs)
          .where(like(schema.jobs.id, "crawl:%"))
      ).map((r) => [r.id, r]),
    );

  it("标记重复、合并城市、保留状态，重跑不再改动", async () => {
    await new JobRepo(handle.db).upsertMany([
      job("a", { cities: ["深圳", "北京"] }),
      job("b", { cities: ["深圳", "武汉"] }),
      job("c", { jobType: "campus" }),
      job("d", { jdText: "另一份 JD" }),
    ]);
    expect(await dedupeJobs(handle.db)).toMatchObject({ groups: 1, duplicates: 1 });
    const r = await rows();
    expect(r["crawl:a"]).toMatchObject({ dup: null, cities: ["深圳", "北京", "武汉"], status: "open" });
    expect(r["crawl:b"]).toMatchObject({ dup: "crawl:a", cities: ["深圳", "武汉"], status: "open" });
    expect(r["crawl:c"]?.dup).toBeNull();
    expect(r["crawl:d"]?.dup).toBeNull();

    expect(await dedupeJobs(handle.db)).toEqual({ groups: 1, duplicates: 1, changed: 0 });
  });

  it("投递过的成为规范岗位，HR 与用户导入的岗位不参与", async () => {
    await new JobRepo(handle.db).upsertMany([
      job("a"),
      job("b"),
      job("hr", { id: "hr-1", source: "hr_workspace" }),
      job("u:1", { id: "user_import:u:1", source: "user_import" }),
    ]);
    const [u] = await handle.db
      .insert(schema.users)
      .values({ email: `${crypto.randomUUID()}@t.local` })
      .returning();
    await handle.db
      .insert(schema.applications)
      .values({ userId: u?.id ?? "", jobId: "crawl:b", channel: "assisted" });
    await dedupeJobs(handle.db);
    const r = await rows();
    expect(r["crawl:b"]?.dup).toBeNull();
    expect(r["crawl:a"]?.dup).toBe("crawl:b");
    const others = await handle.db
      .select({ dup: schema.jobs.duplicateOf })
      .from(schema.jobs)
      .where(eq(schema.jobs.source, "hr_workspace"));
    expect(others).toEqual([{ dup: null }]);
  });

  it("同步时维护：规范岗位下线后由剩下的接替，城市回到官网原值再合并", async () => {
    await syncCrawledJobs(handle.db, [
      job("a", { cities: ["北京"] }),
      job("b", { cities: ["上海"] }),
      job("c"),
    ]);
    let r = await rows();
    expect(r["crawl:a"]).toMatchObject({ dup: null, cities: ["北京", "上海", "深圳"] });

    const res = await syncCrawledJobs(
      handle.db,
      [job("b", { cities: ["上海"] }), job("c")],
      new Map([["crawl", new Set(["b", "c"])]]),
    );
    expect(res.dedupe).toMatchObject({ groups: 1, duplicates: 1 });
    r = await rows();
    expect(r["crawl:a"]).toMatchObject({ dup: null, status: "closed" });
    expect(r["crawl:b"]).toMatchObject({ dup: null, cities: ["上海", "深圳"] });
    expect(r["crawl:c"]?.dup).toBe("crawl:b");

    await syncCrawledJobs(handle.db, [job("b", { cities: ["上海"] }), job("c")]);
    expect(await rows()).toEqual(r);
  });
});
