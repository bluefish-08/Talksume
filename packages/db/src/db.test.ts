import { InvalidTransitionError, type Job } from "@talksume/core";
import { cosineDistance, count, eq, type SQL, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ApplicationNotFoundError,
  ApplicationRepo,
  ConcurrentTransitionError,
  createDb,
  type DbHandle,
  JobRepo,
  migrate,
  schema,
} from "./index.ts";

let handle: DbHandle;

beforeAll(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
});

afterAll(() => handle.close());

async function rows<T>(query: SQL): Promise<T[]> {
  const result = (await handle.db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: crypto.randomUUID(),
    source: "hr_workspace",
    sourceJobId: "J-1",
    company: "示例科技",
    title: "后端实习生",
    cities: ["北京"],
    jdText: "负责服务端开发",
    tags: [],
    fetchedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

async function seedApplication() {
  const { db } = handle;
  const [user] = await db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@example.com` })
    .returning();
  const jobId = crypto.randomUUID();
  await new JobRepo(db).upsertMany([makeJob({ id: jobId, sourceJobId: jobId })]);
  const [app] = await db
    .insert(schema.applications)
    .values({ userId: user?.id ?? "", jobId, channel: "hr_workspace" })
    .returning();
  if (!app) throw new Error("seed failed");
  return app;
}

describe("migrations", () => {
  it("创建全部业务表并启用 vector 扩展", async () => {
    const names = (
      await rows<{ table_name: string }>(
        sql`select table_name from information_schema.tables where table_schema = 'public'`,
      )
    ).map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "users",
        "profiles",
        "profile_facts",
        "conversations",
        "messages",
        "resume_versions",
        "jobs",
        "match_results",
        "applications",
        "application_events",
        "feedback",
        "notifications",
        "llm_call_logs",
      ]),
    );
    expect(await rows(sql`select 1 from pg_extension where extname = 'vector'`)).toHaveLength(1);
  });

  it("重复执行迁移是幂等的", async () => {
    await expect(migrate(handle)).resolves.toBeUndefined();
  });
});

describe("pgvector", () => {
  it("写入 1024 维向量并按余弦距离排序", async () => {
    const unit = (axis: number) => Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : 0));
    const near = makeJob({ id: "near", source: "vec", sourceJobId: "near" });
    const far = makeJob({ id: "far", source: "vec", sourceJobId: "far" });
    await new JobRepo(handle.db).upsertMany([near, far]);
    await handle.db
      .update(schema.jobs)
      .set({ embedding: unit(0) })
      .where(eq(schema.jobs.id, "near"));
    await handle.db
      .update(schema.jobs)
      .set({ embedding: unit(1) })
      .where(eq(schema.jobs.id, "far"));

    const query = unit(0);
    const rows = await handle.db
      .select({ id: schema.jobs.id, distance: cosineDistance(schema.jobs.embedding, query) })
      .from(schema.jobs)
      .where(eq(schema.jobs.source, "vec"))
      .orderBy(cosineDistance(schema.jobs.embedding, query));
    expect(rows.map((r) => r.id)).toEqual(["near", "far"]);
    expect(Number(rows[0]?.distance)).toBeCloseTo(0);
    expect(Number(rows[1]?.distance)).toBeCloseTo(1);
  });
});

describe("ApplicationRepo.transition", () => {
  it("合法迁移在同一事务里更新状态并写事件", async () => {
    const app = await seedApplication();
    const repo = new ApplicationRepo(handle.db);

    await repo.transition(app.id, "applied", "user");
    const change = await repo.transition(app.id, "closed", "hr", "offer");
    expect(change).toMatchObject({ from: "applied", to: "closed", outcome: "offer" });

    const [row] = await handle.db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, app.id));
    expect(row).toMatchObject({ status: "closed", outcome: "offer" });
    const events = await handle.db
      .select()
      .from(schema.applicationEvents)
      .where(eq(schema.applicationEvents.applicationId, app.id))
      .orderBy(schema.applicationEvents.createdAt);
    expect(events.map((e) => [e.fromStatus, e.toStatus, e.source])).toEqual([
      ["pending", "applied", "user"],
      ["applied", "closed", "hr"],
    ]);
  });

  it("非法迁移抛错且不留下事件", async () => {
    const app = await seedApplication();
    const repo = new ApplicationRepo(handle.db);

    await expect(repo.transition(app.id, "interviewing", "user")).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    await expect(repo.transition(crypto.randomUUID(), "applied", "user")).rejects.toBeInstanceOf(
      ApplicationNotFoundError,
    );

    const [{ n } = { n: -1 }] = await handle.db
      .select({ n: count() })
      .from(schema.applicationEvents)
      .where(eq(schema.applicationEvents.applicationId, app.id));
    expect(n).toBe(0);
  });

  it("状态已被别人改过时抛并发冲突错误", async () => {
    const app = await seedApplication();
    const repo = new ApplicationRepo(handle.db);

    await repo.transition(app.id, "applied", "platform");
    const error = await repo
      .transition(app.id, "viewed", "user", undefined, { expectedFrom: "pending" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConcurrentTransitionError);
    expect(error).toMatchObject({ expected: "pending", actual: "applied" });

    const [row] = await handle.db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, app.id));
    expect(row?.status).toBe("applied");
  });
});

describe("JobRepo.upsertMany", () => {
  it("按 (source, source_job_id) 幂等写入并更新内容", async () => {
    const repo = new JobRepo(handle.db);
    const first = makeJob({ source: "idem", sourceJobId: "A", title: "旧标题" });
    const other = makeJob({ source: "idem", sourceJobId: "B" });
    await repo.upsertMany([first, other]);
    await repo.upsertMany([first, other]);
    await repo.upsertMany([{ ...first, id: crypto.randomUUID(), title: "新标题", salaryMin: 8000 }]);

    const rows = await handle.db.select().from(schema.jobs).where(eq(schema.jobs.source, "idem"));
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.sourceJobId === "A");
    expect(a).toMatchObject({ id: first.id, title: "新标题", salaryMin: 8000 });
  });

  it("同一批次内的重复项只保留最后一条", async () => {
    const repo = new JobRepo(handle.db);
    const base = makeJob({ source: "dup", sourceJobId: "X" });
    await repo.upsertMany([base, { ...base, title: "后写入" }]);
    const rows = await handle.db.select().from(schema.jobs).where(eq(schema.jobs.source, "dup"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("后写入");
  });
});
