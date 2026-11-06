import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MigrationError, migrateOwner, OWNED_TABLES } from "./migrate-owner-lib.ts";

let handle: DbHandle;

beforeEach(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
});

afterEach(async () => {
  await handle.close();
});

const DEMO = "demo@talksume.local";
const TARGET = "liming@example.com";

async function seed() {
  const { db } = handle;
  const [demo] = await db
    .insert(schema.users)
    .values({ email: DEMO, resumeStyle: { template: "tech", accent: "teal" } })
    .returning();
  const [target] = await db
    .insert(schema.users)
    .values({ email: TARGET, emailVerifiedAt: new Date() })
    .returning();
  if (!demo || !target) throw new Error("seed failed");
  const now = new Date();
  const job = (id: string, sourceJobId: string, source = "seed") => ({
    id,
    source,
    sourceJobId,
    company: "示例科技",
    title: id,
    jdText: "jd",
    fetchedAt: now,
  });
  await db.insert(schema.jobs).values([job("seed:1", "1"), job("seed:2", "2")]);
  await db.insert(schema.jobs).values(job(`user_import:${demo.id}:abc`, `${demo.id}:abc`, "user_import"));

  await db.insert(schema.profiles).values({ userId: demo.id, data: {} as never });
  const [conv] = await db.insert(schema.conversations).values({ userId: demo.id, title: "对话" }).returning();
  await db.insert(schema.messages).values({ conversationId: conv?.id ?? "", role: "user", content: "你好" });
  const [version] = await db
    .insert(schema.resumeVersions)
    .values({ userId: demo.id, profileVersion: 1, content: {} as never } as never)
    .returning();
  await db.insert(schema.applications).values([
    { userId: demo.id, jobId: "seed:1", channel: "assisted", resumeVersionId: version?.id ?? null },
    { userId: demo.id, jobId: "seed:2", channel: "assisted" },
    { userId: demo.id, jobId: `user_import:${demo.id}:abc`, channel: "assisted" },
  ]);
  await db
    .insert(schema.feedback)
    .values({ userId: demo.id, jobId: `user_import:${demo.id}:abc`, signal: "like" });
  await db
    .insert(schema.notifications)
    .values({ userId: demo.id, kind: "status_changed", title: "状态更新", refId: "a1" });
  // 目标账号已经投过 seed:2，冲突的那条留在原账号
  await db.insert(schema.applications).values({ userId: target.id, jobId: "seed:2", channel: "assisted" });
  return { demo, target };
}

const countFor = async (table: string, userId: string) =>
  Number(
    (
      (await handle.db.execute(
        sql`select count(*)::int as n from ${sql.identifier(table)} where user_id = ${userId}`,
      )) as unknown as { rows: { n: number }[] }
    ).rows[0]?.n,
  );

describe("migrate-owner", () => {
  it("dry-run 只打印各表数量，不改任何数据", async () => {
    const { demo, target } = await seed();
    const report = await migrateOwner(handle.db, { fromEmail: DEMO, toEmail: TARGET, dryRun: true });
    expect(report.dryRun).toBe(true);
    const apps = report.tables.find((t) => t.table === "applications");
    expect(apps).toMatchObject({ total: 3, moved: 2, skipped: 1 });
    expect(report.tables.find((t) => t.table === "profiles")).toMatchObject({ total: 1, moved: 1 });
    expect(report.tables.find((t) => t.table.startsWith("jobs(用户导入"))).toMatchObject({
      total: 1,
      moved: 1,
    });
    expect(await countFor("applications", demo.id)).toBe(3);
    expect(await countFor("applications", target.id)).toBe(1);
    expect(await countFor("profiles", demo.id)).toBe(1);
    const [style] = await handle.db
      .select({ s: schema.users.resumeStyle })
      .from(schema.users)
      .where(eq(schema.users.id, target.id));
    expect(style?.s).toBeNull();
  });

  it("实际执行：数据转到目标账号，冲突行留在原处，用户导入的岗位改归属", async () => {
    const { demo, target } = await seed();
    const report = await migrateOwner(handle.db, { fromEmail: DEMO, toEmail: TARGET, dryRun: false });
    expect(report.resumeStyleCopied).toBe(true);

    expect(await countFor("profiles", target.id)).toBe(1);
    expect(await countFor("conversations", target.id)).toBe(1);
    expect(await countFor("resume_versions", target.id)).toBe(1);
    expect(await countFor("notifications", target.id)).toBe(1);
    expect(await countFor("feedback", target.id)).toBe(1);
    expect(await countFor("applications", target.id)).toBe(3);
    expect(await countFor("applications", demo.id)).toBe(1);
    expect(await countFor("profiles", demo.id)).toBe(0);

    const imported = await handle.db.select().from(schema.jobs).where(eq(schema.jobs.source, "user_import"));
    expect(imported).toHaveLength(1);
    expect(imported[0]?.id).toBe(`user_import:${target.id}:abc`);
    expect(imported[0]?.sourceJobId).toBe(`${target.id}:abc`);
    const [style] = await handle.db
      .select({ s: schema.users.resumeStyle })
      .from(schema.users)
      .where(eq(schema.users.id, target.id));
    expect(style?.s).toEqual({ template: "tech", accent: "teal" });
  });

  it("目标账号已有画像时画像留在原账号，不覆盖", async () => {
    const { demo, target } = await seed();
    await handle.db.insert(schema.profiles).values({ userId: target.id, data: { basics: {} } as never });
    const report = await migrateOwner(handle.db, { fromEmail: DEMO, toEmail: TARGET, dryRun: false });
    expect(report.tables.find((t) => t.table === "profiles")).toMatchObject({
      total: 1,
      moved: 0,
      skipped: 1,
    });
    expect(await countFor("profiles", demo.id)).toBe(1);
    expect(await countFor("profiles", target.id)).toBe(1);
  });

  it("账号不存在或相同时报错", async () => {
    await seed();
    await expect(
      migrateOwner(handle.db, { fromEmail: DEMO, toEmail: "nobody@example.com", dryRun: true }),
    ).rejects.toThrow(MigrationError);
    await expect(migrateOwner(handle.db, { fromEmail: DEMO, toEmail: DEMO, dryRun: true })).rejects.toThrow(
      /同一个/,
    );
  });

  it("所有带 user_id 的业务表都在迁移清单里", () => {
    const covered = new Set(OWNED_TABLES.map((t) => getTableName(t.table)));
    const authOnly = new Set(["sessions", "auth_tokens"]);
    const withUser = Object.values(schema).flatMap((table) => {
      try {
        return "userId" in getTableColumns(table as never) ? [getTableName(table as never)] : [];
      } catch {
        return [];
      }
    });
    expect(withUser.length).toBeGreaterThan(12);
    expect(withUser.filter((name) => !covered.has(name) && !authOnly.has(name))).toEqual([]);
  });
});
