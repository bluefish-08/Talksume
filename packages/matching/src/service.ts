import { createHash } from "node:crypto";
import { type Job, Profile } from "@talksume/core";
import { type Db, JobRepo, schema } from "@talksume/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Embedder } from "./embedder.ts";
import { applyHardFilters, FILTER_HINTS } from "./filters.ts";
import { extractJobFields } from "./import.ts";
import {
  type JobDetail,
  type JobSearch,
  type JobSummary,
  jobColumns,
  loadJob,
  loadVisibleJobs,
  rowToJob,
  searchJobs,
  summarize,
  toDetail,
  USER_IMPORT_SOURCE,
  visibleTo,
} from "./jobs-db.ts";
import { buildScoreContext, DEFAULT_RECALL_LIMIT, matchProfile, scoreJob } from "./pipeline.ts";
import { vectorScores } from "./recall-db.ts";
import { generateReports, type StructuredLlm } from "./rerank.ts";
import {
  DIMENSIONS,
  type FeedbackEntry,
  type FilterReason,
  type MatchOptions,
  type ScoredJob,
  type Weights,
} from "./types.ts";

export class MatchingError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface MatchingServiceOptions {
  llm?: StructuredLlm | null;
  embedder?: Embedder | null;
  weights?: Partial<Weights>;
  rerankTopN?: number;
  recallLimit?: number;
  /** 写入 match_results 的最大条数。 */
  storeLimit?: number;
  onError?: (message: string, error: unknown) => void;
}

export type FeedbackSignal = "like" | "dislike" | "irrelevant";

export interface RefreshResult {
  count: number;
  candidates: number;
  excluded: Record<FilterReason, number>;
  hint?: string;
  rerank: "skipped" | "pending";
  /** 后台报告生成完成时 resolve，永不 reject。 */
  done: Promise<void>;
}

export interface MatchItem {
  jobId: string;
  score: number;
  dims: Record<string, { score: number; weight?: number; evidence?: string[] }>;
  report: { summary?: string; strengths?: string[]; gaps?: string[] };
  feedback: FeedbackSignal | null;
  createdAt: string;
  job: JobSummary;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function toDims(scored: ScoredJob): Record<string, { score: number; weight: number; evidence: string[] }> {
  const dims: Record<string, { score: number; weight: number; evidence: string[] }> = {};
  for (const key of DIMENSIONS) {
    const d = scored.dims[key];
    dims[key] = { score: round3(d.score), weight: round3(scored.weights[key]), evidence: d.evidence };
  }
  if (scored.feedbackMultiplier !== 1) {
    dims.feedback = {
      score: round3(scored.feedbackMultiplier),
      weight: 0,
      evidence: scored.feedbackEvidence,
    };
  }
  return dims;
}

export function createMatchingService(db: Db, options: MatchingServiceOptions = {}) {
  const log = options.onError ?? (() => {});

  async function loadProfile(userId: string): Promise<{ profile: Profile; weights: Partial<Weights> }> {
    const [row] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
    if (!row) throw new MatchingError("profile_not_found", 409, "还没有简历画像，先和助手聊一聊再来看推荐");
    const parsed = Profile.safeParse(row.data);
    if (!parsed.success) throw new MatchingError("profile_invalid", 422, "简历画像格式不正确");
    return { profile: parsed.data, weights: { ...options.weights, ...(row.weights as Partial<Weights>) } };
  }

  async function loadFeedback(userId: string): Promise<FeedbackEntry[]> {
    const rows = await db
      .select({
        jobId: schema.feedback.jobId,
        signal: schema.feedback.signal,
        company: schema.jobs.company,
        title: schema.jobs.title,
      })
      .from(schema.feedback)
      .innerJoin(schema.jobs, eq(schema.jobs.id, schema.feedback.jobId))
      .where(eq(schema.feedback.userId, userId))
      .orderBy(schema.feedback.createdAt);
    const latest = new Map<string, FeedbackEntry>();
    for (const r of rows) {
      if (r.signal === "applied") continue;
      latest.set(r.jobId, { jobId: r.jobId, company: r.company, title: r.title, signal: r.signal });
    }
    return [...latest.values()];
  }

  async function persist(userId: string, results: ScoredJob[], replaceAll: boolean) {
    await db.transaction(async (tx) => {
      const mine = eq(schema.matchResults.userId, userId);
      if (replaceAll) {
        await tx
          .delete(schema.matchResults)
          .where(and(mine, sql`${schema.matchResults.resumeVersionId} is null`));
      } else {
        await tx.delete(schema.matchResults).where(
          and(
            mine,
            sql`${schema.matchResults.resumeVersionId} is null`,
            inArray(
              schema.matchResults.jobId,
              results.map((r) => r.job.id),
            ),
          ),
        );
      }
      for (let i = 0; i < results.length; i += 200) {
        const chunk = results.slice(i, i + 200);
        if (chunk.length === 0) continue;
        await tx
          .insert(schema.matchResults)
          .values(chunk.map((r) => ({ userId, jobId: r.job.id, score: r.score, dims: toDims(r) })));
      }
    });
  }

  async function writeReports(userId: string, profile: Profile, ranked: ScoredJob[]): Promise<void> {
    const llm = options.llm;
    if (!llm) return;
    try {
      const reports = await generateReports(llm, profile, ranked, {
        ...(options.rerankTopN !== undefined && { topN: options.rerankTopN }),
        onError: (error, jobId) => log(`匹配报告生成失败 ${jobId}`, error),
      });
      for (const r of reports) {
        await db
          .update(schema.matchResults)
          .set({ report: r.report, model: r.model })
          .where(
            and(
              eq(schema.matchResults.userId, userId),
              eq(schema.matchResults.jobId, r.jobId),
              sql`${schema.matchResults.resumeVersionId} is null`,
            ),
          );
      }
    } catch (error) {
      log("匹配报告生成失败", error);
    }
  }

  async function refresh(userId: string): Promise<RefreshResult> {
    const { profile, weights } = await loadProfile(userId);
    const [jobs, feedback] = await Promise.all([loadVisibleJobs(db, userId), loadFeedback(userId)]);

    let vectors: Map<string, number> | undefined;
    if (options.embedder) {
      try {
        vectors = await vectorScores(db, userId, options.embedder, profile);
      } catch (error) {
        log("向量召回失败，退回关键词召回", error);
      }
    }

    const matchOptions: MatchOptions = {
      weights,
      feedback,
      recallLimit: options.recallLimit ?? DEFAULT_RECALL_LIMIT,
      ...(vectors && { vectorScores: vectors }),
    };
    const outcome = matchProfile(profile, jobs, matchOptions);
    const stored = outcome.matches.slice(0, options.storeLimit ?? 100);
    await persist(userId, stored, true);

    const done = options.llm && stored.length > 0 ? writeReports(userId, profile, stored) : Promise.resolve();
    const hint = stored.length === 0 ? emptyHint(outcome.excluded) : undefined;
    return {
      count: stored.length,
      candidates: outcome.candidates,
      excluded: outcome.excluded,
      ...(hint && { hint }),
      rerank: options.llm && stored.length > 0 ? "pending" : "skipped",
      done,
    };
  }

  async function listMatches(
    userId: string,
    limit: number,
    jobId?: string,
  ): Promise<{ items: MatchItem[]; total: number }> {
    const m = schema.matchResults;
    const where = and(
      eq(m.userId, userId),
      eq(schema.jobs.status, "open"),
      visibleTo(userId),
      jobId ? eq(m.jobId, jobId) : undefined,
    );
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(m)
      .innerJoin(schema.jobs, eq(schema.jobs.id, m.jobId))
      .where(where);
    const rows = await db
      .select({
        jobId: m.jobId,
        score: m.score,
        dims: m.dims,
        report: m.report,
        createdAt: m.createdAt,
        job: jobColumns,
      })
      .from(m)
      .innerJoin(schema.jobs, eq(schema.jobs.id, m.jobId))
      .where(where)
      .orderBy(desc(m.score), m.jobId)
      .limit(limit);

    const signals = new Map<string, FeedbackSignal>();
    if (rows.length > 0) {
      const fb = await db
        .select({ jobId: schema.feedback.jobId, signal: schema.feedback.signal })
        .from(schema.feedback)
        .where(
          and(
            eq(schema.feedback.userId, userId),
            inArray(
              schema.feedback.jobId,
              rows.map((r) => r.jobId),
            ),
          ),
        )
        .orderBy(schema.feedback.createdAt);
      for (const f of fb) if (f.signal !== "applied") signals.set(f.jobId, f.signal);
    }
    return {
      total: count?.n ?? 0,
      items: rows.map((r) => ({
        jobId: r.jobId,
        score: r.score,
        dims: r.dims,
        report: r.report,
        feedback: signals.get(r.jobId) ?? null,
        createdAt: r.createdAt.toISOString(),
        job: summarize(rowToJob(r.job)),
      })),
    };
  }

  async function recordFeedback(userId: string, jobId: string, signal: FeedbackSignal, reason?: string) {
    const found = await loadJob(db, userId, jobId);
    if (!found) throw new MatchingError("job_not_found", 404, "岗位不存在");
    const [current] = await db
      .select({ id: schema.matchResults.id })
      .from(schema.matchResults)
      .where(
        and(
          eq(schema.matchResults.userId, userId),
          eq(schema.matchResults.jobId, jobId),
          sql`${schema.matchResults.resumeVersionId} is null`,
        ),
      );
    const [row] = await db
      .insert(schema.feedback)
      .values({ userId, jobId, signal, reason: reason ?? null, matchResultId: current?.id ?? null })
      .returning();
    if (!row) throw new Error("feedback insert failed");
    return { id: row.id, jobId, signal, reason: row.reason, createdAt: row.createdAt.toISOString() };
  }

  async function importJob(
    userId: string,
    input: { text: string; url?: string },
  ): Promise<{ job: JobDetail; match: MatchItem | null; excluded?: FilterReason }> {
    const text = input.text.trim();
    const fields = await extractJobFields(text, options.llm, (error) =>
      log("JD 抽取失败，退回规则抽取", error),
    );
    const hash = createHash("sha1").update(text).digest("hex").slice(0, 16);
    const sourceJobId = `${userId}:${hash}`;
    const job: Job = {
      id: `${USER_IMPORT_SOURCE}:${sourceJobId}`,
      source: USER_IMPORT_SOURCE,
      sourceJobId,
      company: fields.company,
      title: fields.title,
      cities: fields.cities,
      ...(fields.jobType && { jobType: fields.jobType }),
      ...(fields.degree && { degree: fields.degree }),
      ...(fields.salaryMin !== undefined && { salaryMin: fields.salaryMin }),
      ...(fields.salaryMax !== undefined && { salaryMax: fields.salaryMax }),
      jdText: text,
      ...(input.url && { url: input.url }),
      tags: fields.tags,
      fetchedAt: new Date(),
    };
    await new JobRepo(db).upsertMany([job]);

    const detail = toDetail(job, "open");
    const [profileRow] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
    if (!profileRow) return { job: detail, match: null };
    const { profile, weights } = await loadProfile(userId);

    const filter = applyHardFilters(profile, job);
    if (!filter.pass) return { job: detail, match: null, ...(filter.reason && { excluded: filter.reason }) };

    const [all, feedback] = await Promise.all([loadVisibleJobs(db, userId), loadFeedback(userId)]);
    const ctx = buildScoreContext(all.map((a) => a.job));
    const scored = scoreJob(profile, job, ctx, { weights, feedback });
    await persist(userId, [scored], false);
    const [item] = (await listMatches(userId, 1, job.id)).items;
    return { job: detail, match: item ?? null };
  }

  return {
    refresh,
    listMatches,
    recordFeedback,
    importJob,
    searchJobs: (userId: string, search: JobSearch) => searchJobs(db, userId, search),
    getJob: async (userId: string, id: string) => {
      const found = await loadJob(db, userId, id);
      return found ? toDetail(found.job, found.status) : undefined;
    },
  };
}

export type MatchingService = ReturnType<typeof createMatchingService>;

const REASON_LABEL = { jobType: "求职类型", city: "城市", degree: "学历要求", closed: "岗位状态" } as const;

function emptyHint(excluded: Record<FilterReason, number>): string {
  const top = (Object.entries(excluded) as [FilterReason, number][])
    .filter(([reason]) => reason !== "closed")
    .sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] === 0) return "岗位库里暂时没有可推荐的岗位";
  const [reason, n] = top;
  return `没有符合条件的职位：${n} 个岗位被「${REASON_LABEL[reason]}」过滤，建议${FILTER_HINTS[reason]}`;
}
