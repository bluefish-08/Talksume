import type { Job } from "@talksume/core";
import { sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import { jobs } from "./schema.ts";

const CHUNK_SIZE = 500;

export class JobRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** 按 (source, source_job_id) 幂等写入；已存在则更新内容并保留原 id 与已有向量。 */
  async upsertMany(items: Job[]): Promise<void> {
    const latest = new Map<string, Job>();
    for (const job of items) latest.set(`${job.source}\u0000${job.sourceJobId}`, job);
    const rows = [...latest.values()].map((job) => ({
      id: job.id,
      source: job.source,
      sourceJobId: job.sourceJobId,
      company: job.company,
      title: job.title,
      cities: job.cities,
      jobType: job.jobType ?? null,
      salaryMin: job.salaryMin ?? null,
      salaryMax: job.salaryMax ?? null,
      degree: job.degree ?? null,
      jdText: job.jdText,
      url: job.url ?? null,
      tags: job.tags,
      postedAt: job.postedAt ?? null,
      fetchedAt: job.fetchedAt,
    }));

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await this.#db
        .insert(jobs)
        .values(rows.slice(i, i + CHUNK_SIZE))
        .onConflictDoUpdate({
          target: [jobs.source, jobs.sourceJobId],
          set: {
            company: sql`excluded.company`,
            title: sql`excluded.title`,
            cities: sql`excluded.cities`,
            jobType: sql`excluded.job_type`,
            salaryMin: sql`excluded.salary_min`,
            salaryMax: sql`excluded.salary_max`,
            degree: sql`excluded.degree`,
            jdText: sql`excluded.jd_text`,
            url: sql`excluded.url`,
            tags: sql`excluded.tags`,
            postedAt: sql`excluded.posted_at`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    }
  }
}
