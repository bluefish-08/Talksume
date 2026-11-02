import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { type Job, Profile } from "@talksume/core";
import { type Db, JobRepo, schema } from "@talksume/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Embedder } from "./embedder.ts";
import { applyHardFilters, FILTER_HINTS } from "./filters.ts";
import { extractJobFields } from "./import.ts";
import {
  canonicalJob,
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
import {
  buildScoreContext,
  DEFAULT_RECALL_LIMIT,
  MIN_RECOMMEND_SCORE,
  matchProfile,
  scoreJob,
} from "./pipeline.ts";
import { vectorScores } from "./recall-db.ts";
import {
  DEFAULT_RERANK_TOP_N,
  generateReport,
  generateReports,
  type RerankOptions,
  type StructuredLlm,
} from "./rerank.ts";
import { classifyRole } from "./role.ts";
import {
  DIMENSIONS,
  type FeedbackEntry,
  type FilterReason,
  type MatchOptions,
  type MatchOutcome,
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
  /** 覆盖报告生成的并发、超时、重试等参数。 */
  rerank?: Pick<
    RerankOptions,
    "concurrency" | "attemptTimeoutMs" | "attempts" | "retryDelayMs" | "maxTokens"
  >;
  recallLimit?: number;
  /** 规则分低于该值的岗位不写入推荐，默认 MIN_RECOMMEND_SCORE。 */
  minScore?: number;
  /** 写入 match_results 的最大条数。 */
  storeLimit?: number;
  onError?: (message: string, error: unknown) => void;
}

export type FeedbackSignal = "like" | "dislike" | "irrelevant";
export type ReportStatus = "ready" | "pending" | "failed" | "none";

/** 进程重启等原因让 pending 永远没人收尾时，超过该时长按失败处理，避免前端一直转圈。 */
export const REPORT_STALE_MS = 6 * 60_000;

export function reportStatusOf(report: schema.MatchReport, now = Date.now()): ReportStatus {
  if (report.summary || report.strengths?.length || report.gaps?.length) return "ready";
  if (report.status === "failed") return "failed";
  if (report.status === "pending") {
    const started = report.startedAt ? Date.parse(report.startedAt) : Number.NaN;
    return Number.isFinite(started) && now - started <= REPORT_STALE_MS ? "pending" : "failed";
  }
  return "none";
}

export interface RefreshResult {
  count: number;
  candidates: number;
  excluded: Record<FilterReason, number>;
  hint?: string;
  rerank: "skipped" | "pending";
  /** 后台报告生成完成时 resolve，永不 reject。 */
  done: Promise<void>;
}

export interface AssistantFilter {
  city?: string | undefined;
  jobType?: Job["jobType"] | undefined;
  keyword?: string | undefined;
  limit: number;
}

export type MatchDims = MatchItem["dims"];

export interface ScoredSummary {
  job: JobSummary;
  score: number;
  dims: MatchDims;
}

export interface JobInsightData extends ScoredSummary {
  report?: MatchItem["report"];
  /** 没通过硬性筛选的原因。 */
  blocked?: string;
}

export interface MatchItem {
  jobId: string;
  score: number;
  dims: Record<string, { score: number; weight?: number; evidence?: string[] }>;
  report: { summary?: string; strengths?: string[]; gaps?: string[] };
  /** none：没有为该岗位生成报告；pending：生成中；failed：失败或超时，可重试。 */
  reportStatus: ReportStatus;
  feedback: FeedbackSignal | null;
  createdAt: string;
  job: JobSummary;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

const pendingReport = (): schema.MatchReport => ({ status: "pending", startedAt: new Date().toISOString() });

function publicReport(report: schema.MatchReport): MatchItem["report"] {
  const { status: _status, startedAt: _startedAt, ...content } = report;
  return content;
}

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

  /** 传 override 时用调用方手里的画像（对话中可能还没落库），只从库里取权重。 */
  async function loadProfile(
    userId: string,
    override?: Profile,
  ): Promise<{ profile: Profile; weights: Partial<Weights> }> {
    const [row] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
    if (override)
      return { profile: override, weights: { ...options.weights, ...(row?.weights as Partial<Weights>) } };
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

  async function persist(userId: string, results: ScoredJob[], replaceAll: boolean, pendingTop = 0) {
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
        await tx.insert(schema.matchResults).values(
          chunk.map((r, j) => ({
            userId,
            jobId: r.job.id,
            score: r.score,
            dims: toDims(r),
            ...(i + j < pendingTop && { report: pendingReport() }),
          })),
        );
      }
    });
  }

  const topN = () => options.rerankTopN ?? DEFAULT_RERANK_TOP_N;

  const reportWhere = (userId: string, jobId: string) =>
    and(
      eq(schema.matchResults.userId, userId),
      eq(schema.matchResults.jobId, jobId),
      sql`${schema.matchResults.resumeVersionId} is null`,
    );

  async function storeReport(userId: string, jobId: string, report: schema.MatchReport, model?: string) {
    await db
      .update(schema.matchResults)
      .set({ report, ...(model && { model }) })
      .where(reportWhere(userId, jobId));
  }

  const rerankOptions = (userId: string): RerankOptions => ({
    ...options.rerank,
    onReport: (r) => storeReport(userId, r.jobId, r.report, r.model),
    onError: async (error, jobId) => {
      log(`匹配报告生成失败 ${jobId}`, error);
      await storeReport(userId, jobId, { status: "failed" }).catch((e) => log("写入报告失败状态出错", e));
    },
  });

  /** 报告随生成随写入，前端不必等最慢的那一个。 */
  async function writeReports(userId: string, profile: Profile, ranked: ScoredJob[]): Promise<void> {
    const llm = options.llm;
    if (!llm) return;
    try {
      await generateReports(llm, profile, ranked, { ...rerankOptions(userId), topN: topN() });
    } catch (error) {
      log("匹配报告生成失败", error);
    }
  }

  async function refresh(userId: string, override?: Profile): Promise<RefreshResult> {
    const { profile, weights } = await loadProfile(userId, override);
    const [jobs, feedback] = await Promise.all([
      loadVisibleJobs(db, userId, { canonicalOnly: true }),
      loadFeedback(userId),
    ]);

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
      minScore: options.minScore ?? MIN_RECOMMEND_SCORE,
      ...(vectors && { vectorScores: vectors }),
    };
    const outcome = matchProfile(profile, jobs, matchOptions);
    const stored = outcome.matches.slice(0, options.storeLimit ?? 100);
    await persist(userId, stored, true, options.llm ? topN() : 0);

    const done = options.llm && stored.length > 0 ? writeReports(userId, profile, stored) : Promise.resolve();
    const hint = stored.length === 0 ? emptyHint(outcome) : undefined;
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
      jobId ? eq(m.jobId, jobId) : canonicalJob,
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
        report: publicReport(r.report),
        reportStatus: reportStatusOf(r.report),
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

  /** 单个岗位的报告失败后由用户触发重试；已在生成或已有报告时不重复调用模型。 */
  async function retryReport(
    userId: string,
    jobId: string,
  ): Promise<{ reportStatus: ReportStatus; done: Promise<void> }> {
    const llm = options.llm;
    if (!llm) throw new MatchingError("llm_unavailable", 503, "AI 解读暂未开启");
    const { profile, weights } = await loadProfile(userId);
    const [current] = await db
      .select({ report: schema.matchResults.report })
      .from(schema.matchResults)
      .where(reportWhere(userId, jobId));
    if (!current) throw new MatchingError("match_not_found", 404, "这个岗位还没有匹配结果");
    const status = reportStatusOf(current.report);
    if (status === "pending" || status === "ready") return { reportStatus: status, done: Promise.resolve() };

    const [all, feedback] = await Promise.all([loadVisibleJobs(db, userId), loadFeedback(userId)]);
    const job = all.find((a) => a.job.id === jobId)?.job;
    if (!job) throw new MatchingError("job_not_found", 404, "岗位不存在");
    const scored = scoreJob(profile, job, buildScoreContext(all.map((a) => a.job)), { weights, feedback });
    await storeReport(userId, jobId, pendingReport());

    const done = generateReport(llm, profile, scored, options.rerank)
      .then((r) => storeReport(userId, jobId, r.report, r.model))
      .catch(async (error) => {
        log(`匹配报告重试失败 ${jobId}`, error);
        await storeReport(userId, jobId, { status: "failed" }).catch((e) => log("写入报告失败状态出错", e));
      });
    return { reportStatus: "pending", done };
  }

  const plainJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

  /** 没有推荐、画像在推荐之后更新过，或传入的画像与库里不同（对话中尚未落库）时，已存推荐视为过期。 */
  async function matchesStale(userId: string, profile: Profile): Promise<boolean> {
    const m = schema.matchResults;
    const [[row], [latest]] = await Promise.all([
      db
        .select({ data: schema.profiles.data, updatedAt: schema.profiles.updatedAt })
        .from(schema.profiles)
        .where(eq(schema.profiles.userId, userId)),
      db
        .select({ at: sql`max(${m.createdAt})`.mapWith(m.createdAt) })
        .from(m)
        .where(and(eq(m.userId, userId), sql`${m.resumeVersionId} is null`)),
    ]);
    if (!row || !latest?.at) return true;
    if (row.updatedAt > latest.at) return true;
    return !isDeepStrictEqual(plainJson(row.data), plainJson(profile));
  }

  async function scoreFor(userId: string, profile: Profile, ids: readonly string[]) {
    const { weights } = await loadProfile(userId, profile);
    const [all, feedback] = await Promise.all([loadVisibleJobs(db, userId), loadFeedback(userId)]);
    const ctx = buildScoreContext(all.map((a) => a.job));
    const wanted = new Set(ids);
    return new Map(
      all
        .filter((a) => wanted.has(a.job.id))
        .map((a) => [
          a.job.id,
          { scored: scoreJob(profile, a.job, ctx, { weights, feedback }), status: a.status },
        ]),
    );
  }

  /** 对话里的推荐：已存推荐过期时先按传入的画像重新匹配，再按条件收窄。 */
  async function recommendFor(userId: string, profile: Profile, filter: AssistantFilter) {
    let hint: string | undefined;
    if (await matchesStale(userId, profile)) {
      const result = await refresh(userId, profile);
      hint = result.hint;
    }
    const { items } = await listMatches(userId, options.storeLimit ?? 100);
    const pool = items.filter((m) => m.feedback !== "dislike" && m.feedback !== "irrelevant");
    const city = filter.city?.trim();
    const keyword = filter.keyword?.trim().toLowerCase();
    // 「后端」也要命中「后台」「服务端」：能归到岗位大类的关键词按大类比，否则按字面
    const family = keyword ? classifyRole(keyword) : undefined;
    const byFamily = family && family !== "other" && family !== "tech_other";
    const narrowed = pool.filter(
      ({ job }) =>
        (!city || job.cities.some((c) => c.includes(city) || city.includes(c))) &&
        (!filter.jobType || !job.jobType || job.jobType === filter.jobType) &&
        (!keyword ||
          (byFamily
            ? classifyRole(job.title) === family
            : `${job.title} ${job.tags.join(" ")}`.toLowerCase().includes(keyword))),
    );
    if (!hint && narrowed.length === 0 && pool.length > 0) {
      hint = `推荐列表里有 ${pool.length} 个岗位，但没有符合这些条件的`;
    }
    return { items: narrowed.slice(0, filter.limit), total: narrowed.length, ...(hint && { hint }) };
  }

  /** 在全部在招岗位里搜索，匹配度按传入的画像现算，不写入推荐。 */
  async function searchFor(
    userId: string,
    profile: Profile,
    search: Omit<JobSearch, "page" | "pageSize"> & { limit: number },
  ): Promise<{ items: ScoredSummary[]; total: number }> {
    const { limit, ...query } = search;
    const found = await searchJobs(db, userId, { ...query, page: 1, pageSize: limit });
    if (found.items.length === 0) return { items: [], total: found.total };
    const scores = await scoreFor(
      userId,
      profile,
      found.items.map((j) => j.id),
    );
    return {
      total: found.total,
      items: found.items.flatMap((job) => {
        const hit = scores.get(job.id);
        return hit ? [{ job, score: hit.scored.score, dims: toDims(hit.scored) }] : [];
      }),
    };
  }

  /** 单个岗位的匹配解读：优先复用已生成的报告，没有就现场生成，模型不可用时只给规则打分。 */
  async function explainFor(userId: string, profile: Profile, jobId: string): Promise<JobInsightData | null> {
    const hit = (await scoreFor(userId, profile, [jobId])).get(jobId);
    if (!hit) return null;
    const { scored, status } = hit;
    const filter = applyHardFilters(profile, scored.job, { status });
    const fresh = !(await matchesStale(userId, profile));
    let report: MatchItem["report"] | undefined;
    if (fresh) {
      const [row] = await db
        .select({ report: schema.matchResults.report })
        .from(schema.matchResults)
        .where(reportWhere(userId, jobId));
      if (row && reportStatusOf(row.report) === "ready") report = publicReport(row.report);
    }
    if (!report && options.llm) {
      try {
        const generated = await generateReport(options.llm, profile, scored, {
          ...options.rerank,
          attempts: 1,
        });
        report = generated.report;
        if (fresh) await storeReport(userId, jobId, generated.report, generated.model);
      } catch (error) {
        log(`对话中的匹配解读生成失败 ${jobId}`, error);
      }
    }
    return {
      job: summarize(scored.job),
      score: scored.score,
      dims: toDims(scored),
      ...(report && { report }),
      ...(!filter.pass &&
        filter.reason && { blocked: `${REASON_LABEL[filter.reason]}不符：${filter.detail ?? ""}` }),
    };
  }

  return {
    refresh,
    listMatches,
    recommendFor,
    searchFor,
    explainFor,
    retryReport,
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

function emptyHint(outcome: Pick<MatchOutcome, "excluded" | "belowThreshold">): string {
  const top = (Object.entries(outcome.excluded) as [FilterReason, number][])
    .filter(([reason]) => reason !== "closed")
    .sort((a, b) => b[1] - a[1])[0];
  if (outcome.belowThreshold > 0 && (!top || top[1] <= outcome.belowThreshold)) {
    return "现有岗位和你的技能、经历、意向相关度都不高，建议补充技能与项目，或调整意向岗位方向";
  }
  if (!top || top[1] === 0) return "岗位库里暂时没有可推荐的岗位";
  const [reason, n] = top;
  return `没有符合条件的职位：${n} 个岗位被「${REASON_LABEL[reason]}」过滤，建议${FILTER_HINTS[reason]}`;
}
