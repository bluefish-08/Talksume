import { existsSync, readFileSync } from "node:fs";
import { Job } from "@talksume/core";
import { type Db, JobRepo, schema } from "@talksume/db";
import { sql } from "drizzle-orm";

export const SEED_USAGE = "请通过参数或环境变量 SEED_JOBS_PATH 指定岗位 jsonl 文件（可用 jobs-ingest 抓取）";

export function readSeedJobs(path = process.env.SEED_JOBS_PATH): Job[] {
  if (!path) throw new Error(SEED_USAGE);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => Job.parse(JSON.parse(line)));
}

/** 幂等：按 (source, source_job_id) upsert，重复执行不产生重复行。 */
export async function seedJobs(db: Db, path?: string): Promise<number> {
  const jobs = readSeedJobs(path);
  await new JobRepo(db).upsertMany(jobs);
  return jobs.length;
}

/** 岗位表为空且给出了存在的种子文件（参数或 SEED_JOBS_PATH）时才导入，否则返回 0。 */
export async function seedJobsIfEmpty(db: Db, path = process.env.SEED_JOBS_PATH): Promise<number> {
  if (!path || !existsSync(path)) return 0;
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.jobs);
  if ((row?.n ?? 0) > 0) return 0;
  return seedJobs(db, path);
}
