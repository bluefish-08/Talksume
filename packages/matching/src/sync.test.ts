import type { Job } from "@talksume/core";
import { createDb, type DbHandle, EMBEDDING_DIMENSIONS, JobRepo, migrate, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncCrawledJobs } from "./sync.ts";

let handle: DbHandle;
beforeAll(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
});
afterAll(() => handle.close());

const job = (sourceJobId: string, over: Partial<Job> = {}): Job => ({
  id: `crawl:${sourceJobId}`,
  source: "crawl",
  sourceJobId,
  company: "示例公司",
  title: "后端开发",
  cities: ["北京"],
  jdText: "负责服务端开发",
  tags: [],
  fetchedAt: new Date("2026-11-01T00:00:00Z"),
  ...over,
});

const rowOf = async (sourceJobId: string) =>
  (await handle.db.select().from(schema.jobs).where(eq(schema.jobs.sourceJobId, sourceJobId)))[0];

describe("syncCrawledJobs", () => {
  it("官网不再出现的标为下线，重新出现的恢复，HR 岗位不受影响", async () => {
    await new JobRepo(handle.db).upsertMany([job("hr-1", { id: "hr-1", source: "hr_workspace" })]);
    await syncCrawledJobs(handle.db, [job("a"), job("b"), job("c")]);

    const r = await syncCrawledJobs(handle.db, [job("a")], new Map([["crawl", new Set(["a", "b"])]]));
    expect(r.closed).toEqual({ crawl: 1 });
    expect((await rowOf("b"))?.status).toBe("open");
    expect((await rowOf("c"))?.status).toBe("closed");
    expect((await rowOf("hr-1"))?.status).toBe("open");

    await syncCrawledJobs(handle.db, [job("c")]);
    expect((await rowOf("c"))?.status).toBe("open");
  });

  it("拒绝写入 HR 与用户导入来源", async () => {
    await expect(syncCrawledJobs(handle.db, [job("x", { source: "user_import" })])).rejects.toThrow();
  });

  it("内容不变保留向量，JD 变了清空向量待重算", async () => {
    const embedding = new Array<number>(EMBEDDING_DIMENSIONS).fill(0.1);
    await syncCrawledJobs(handle.db, [job("e1"), job("e2")]);
    await handle.db.update(schema.jobs).set({ embedding }).where(eq(schema.jobs.source, "crawl"));

    await syncCrawledJobs(handle.db, [job("e1", { tags: ["新标签"] }), job("e2", { jdText: "改过的 JD" })]);
    expect((await rowOf("e1"))?.embedding).not.toBeNull();
    expect((await rowOf("e2"))?.embedding).toBeNull();
  });
});
