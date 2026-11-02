import type { Job } from "@talksume/core";
import { type Db, schema } from "@talksume/db";
import { and, eq, getTableColumns, or, type SQL, sql } from "drizzle-orm";

export const USER_IMPORT_SOURCE = "user_import";

const { embedding: _embedding, ...jobColumns } = getTableColumns(schema.jobs);

export { jobColumns };

type SelectedRow = Awaited<ReturnType<typeof selectJobs>>[number];

function selectJobs(db: Db, where?: SQL) {
  return db.select(jobColumns).from(schema.jobs).where(where);
}

/** 用户导入的 JD 只对导入者可见：sourceJobId 以 `<userId>:` 开头。 */
export function visibleTo(userId: string): SQL {
  return or(
    sql`${schema.jobs.source} <> ${USER_IMPORT_SOURCE}`,
    sql`${schema.jobs.sourceJobId} like ${`${userId}:%`}`,
  ) as SQL;
}

export function rowToJob(row: SelectedRow): Job {
  return {
    id: row.id,
    source: row.source,
    sourceJobId: row.sourceJobId,
    company: row.company,
    title: row.title,
    cities: row.cities,
    ...(row.jobType && { jobType: row.jobType }),
    ...(row.salaryMin !== null && { salaryMin: row.salaryMin }),
    ...(row.salaryMax !== null && { salaryMax: row.salaryMax }),
    ...(row.degree && { degree: row.degree }),
    jdText: row.jdText,
    ...(row.url && { url: row.url }),
    tags: row.tags,
    ...(row.postedAt && { postedAt: row.postedAt }),
    fetchedAt: row.fetchedAt,
  };
}

export async function loadVisibleJobs(db: Db, userId: string): Promise<{ job: Job; status: string }[]> {
  const rows = await selectJobs(db, visibleTo(userId));
  return rows.map((r) => ({ job: rowToJob(r), status: r.status }));
}

export async function loadJob(
  db: Db,
  userId: string,
  id: string,
): Promise<{ job: Job; status: string } | undefined> {
  const [row] = await selectJobs(db, and(eq(schema.jobs.id, id), visibleTo(userId)));
  return row ? { job: rowToJob(row), status: row.status } : undefined;
}

export interface JobSummary {
  id: string;
  source: string;
  company: string;
  title: string;
  cities: string[];
  jobType?: Job["jobType"];
  salaryMin?: number;
  salaryMax?: number;
  degree?: Job["degree"];
  tags: string[];
  url?: string;
  postedAt?: string;
  snippet: string;
}

export type JobDetail = JobSummary & { jdText: string; status?: string };

export function summarize(job: Job): JobSummary {
  return {
    id: job.id,
    source: job.source,
    company: job.company,
    title: job.title,
    cities: job.cities,
    ...(job.jobType && { jobType: job.jobType }),
    ...(job.salaryMin !== undefined && { salaryMin: job.salaryMin }),
    ...(job.salaryMax !== undefined && { salaryMax: job.salaryMax }),
    ...(job.degree && { degree: job.degree }),
    tags: job.tags,
    ...(job.url && { url: job.url }),
    ...(job.postedAt && { postedAt: job.postedAt.toISOString() }),
    snippet: job.jdText.replace(/\s+/g, " ").slice(0, 120),
  };
}

export function toDetail(job: Job, status?: string): JobDetail {
  return { ...summarize(job), jdText: job.jdText, ...(status && { status }) };
}

export interface JobSearch {
  q?: string;
  city?: string;
  jobType?: NonNullable<Job["jobType"]>;
  company?: string;
  page: number;
  pageSize: number;
}

const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

export async function searchJobs(
  db: Db,
  userId: string,
  search: JobSearch,
): Promise<{ items: JobSummary[]; total: number }> {
  const t = schema.jobs;
  const conds: (SQL | undefined)[] = [eq(t.status, "open"), visibleTo(userId)];
  if (search.city) conds.push(sql`${search.city} = any(${t.cities})`);
  if (search.jobType) conds.push(eq(t.jobType, search.jobType));
  if (search.company) conds.push(sql`${t.company} ilike ${likePattern(search.company)}`);
  const q = search.q?.trim();
  if (q) {
    const p = likePattern(q);
    conds.push(sql`(${t.title} ilike ${p} or ${t.company} ilike ${p} or ${t.jdText} ilike ${p})`);
  }
  const where = and(...conds);

  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(t).where(where);
  const titleFirst = q ? sql`(${t.title} ilike ${likePattern(q)}) desc,` : sql``;
  const rows = await db
    .select(jobColumns)
    .from(t)
    .where(where)
    .orderBy(sql`${titleFirst} ${t.fetchedAt} desc, ${t.id}`)
    .limit(search.pageSize)
    .offset((search.page - 1) * search.pageSize);
  return { items: rows.map((r) => summarize(rowToJob(r))), total: count?.n ?? 0 };
}
