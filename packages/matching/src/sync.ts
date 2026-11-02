import type { Job } from "@talksume/core";
import { type Db, JobRepo, schema } from "@talksume/db";
import { and, eq, sql } from "drizzle-orm";
import { USER_IMPORT_SOURCE } from "./jobs-db.ts";

const PROTECTED_SOURCES = new Set(["hr_workspace", USER_IMPORT_SOURCE]);

export interface SyncResult {
  upserted: number;
  closed: Record<string, number>;
}

/**
 * 把抓取结果同步进岗位库：upsert 并重新打开回到官网的岗位；
 * `online` 给出各来源仍在招的 sourceJobId（含因限量没入库的），不在其中的同来源岗位标为 closed，不删除。
 */
export async function syncCrawledJobs(
  db: Db,
  jobs: Job[],
  online?: Map<string, Set<string>>,
): Promise<SyncResult> {
  const bad = jobs.find((j) => PROTECTED_SOURCES.has(j.source));
  if (bad) throw new Error(`抓取同步不能写入 ${bad.source} 来源的岗位`);
  await new JobRepo(db).upsertMany(jobs, { reopen: true });

  const closed: Record<string, number> = {};
  for (const [source, ids] of online ?? []) {
    if (PROTECTED_SOURCES.has(source)) continue;
    const t = schema.jobs;
    const rows = await db
      .update(t)
      .set({ status: "closed" })
      .where(
        and(
          eq(t.source, source),
          eq(t.status, "open"),
          sql`not (${t.sourceJobId} = any(${sql.param([...ids])}::text[]))`,
        ),
      )
      .returning({ id: t.id });
    closed[source] = rows.length;
  }
  return { upserted: jobs.length, closed };
}
