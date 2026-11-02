import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Job } from "@talksume/core";
import { type Db, JobRepo, schema } from "@talksume/db";
import { sql } from "drizzle-orm";

export const DEFAULT_SEED_PATH = fileURLToPath(new URL("../../../data/seed/jobs.jsonl", import.meta.url));

export function readSeedJobs(path = process.env.SEED_JOBS_PATH || DEFAULT_SEED_PATH): Job[] {
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

/** 岗位表为空时才灌入种子，供服务启动时调用。 */
export async function seedJobsIfEmpty(db: Db, path?: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.jobs);
  if ((row?.n ?? 0) > 0) return 0;
  return seedJobs(db, path);
}
