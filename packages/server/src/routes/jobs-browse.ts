import { type Job, JobType, Profile } from "@talksume/core";
import { type Db, schema } from "@talksume/db";
import {
  applyHardFilters,
  buildScoreContext,
  canonicalJob,
  createMatchingService,
  DEGREE_LABEL,
  DIMENSIONS,
  type FilterReason,
  highestDegree,
  jobColumns,
  loadJob,
  MIN_RECOMMEND_SCORE,
  profileCities,
  requiredDegree,
  rowToJob,
  type ScoreContext,
  type ScoredJob,
  scoreJob,
  summarize,
  visibleTo,
  type Weights,
} from "@talksume/matching";
import { and, arrayOverlaps, count, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import type { RouteModule } from "../app.ts";

const t = schema.jobs;
const m = schema.matchResults;

const Degree = z.enum(["any", "associate", "bachelor", "master", "phd"]);
const csv = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .string()
    .max(1000)
    .optional()
    .transform((s) => [...new Set((s ?? "").split(",").map((x) => x.trim()))].filter(Boolean).slice(0, 30))
    .pipe(z.array(item));

const Filters = z.object({
  q: z.string().trim().max(100).optional(),
  company: csv(z.string().max(50)),
  city: csv(z.string().max(30)),
  type: csv(JobType),
  degree: csv(Degree),
});
type Filters = z.infer<typeof Filters>;

const ListQuery = Filters.extend({
  sort: z.enum(["latest", "match"]).default("latest"),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

type Facet = "company" | "city" | "type" | "degree";
const FACET_LIMIT = 50;

const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;
const recency = sql`coalesce(${t.postedAt}, ${t.fetchedAt})`;
// 与 jobs_search_trgm_idx 的表达式保持一致
const searchText = sql`(${t.title} || ' ' || ${t.company} || ' ' || ${t.jdText})`;
const degreeOf = sql<string>`coalesce(${t.degree}, 'any')`;

function where(userId: string, f: Filters, omit?: Facet): SQL | undefined {
  const conds: (SQL | undefined)[] = [eq(t.status, "open"), canonicalJob, visibleTo(userId)];
  if (omit !== "company" && f.company.length) conds.push(inArray(t.company, f.company));
  if (omit !== "city" && f.city.length) conds.push(arrayOverlaps(t.cities, f.city));
  if (omit !== "type" && f.type.length) conds.push(inArray(t.jobType, f.type));
  if (omit !== "degree" && f.degree.length) conds.push(inArray(degreeOf, f.degree));
  if (f.q) {
    const p = likePattern(f.q);
    conds.push(sql`${searchText} ilike ${p}`);
  }
  return and(...conds);
}

const JOB_TYPE_LABEL = { internship: "实习", campus: "校招", experienced: "社招" } as const;

function excludedMessage(reason: FilterReason, profile: Profile, job: Job): string {
  if (reason === "jobType" && profile.intention.jobType && job.jobType) {
    return `求职类型不同：你想找${JOB_TYPE_LABEL[profile.intention.jobType]}，这是${JOB_TYPE_LABEL[job.jobType]}`;
  }
  if (reason === "city") {
    return `城市不在意向内：你的意向城市是${profileCities(profile).join("、")}，这个岗位在${job.cities.join("、")}`;
  }
  if (reason === "degree") {
    const have = highestDegree(profile);
    const need = requiredDegree(job);
    if (have && need) {
      return `学历要求更高：你的最高学历是${DEGREE_LABEL[have]}，这个岗位要求${DEGREE_LABEL[need.degree]}及以上`;
    }
  }
  if (reason === "closed") return "岗位已关闭";
  return "不符合你的求职意向";
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function toDims(scored: ScoredJob) {
  const dims: Record<string, { score: number; weight: number; evidence: string[] }> = {};
  for (const key of DIMENSIONS) {
    dims[key] = {
      score: round3(scored.dims[key].score),
      weight: round3(scored.weights[key]),
      evidence: scored.dims[key].evidence,
    };
  }
  return dims;
}

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

/** IDF 按全库计算，岗位数和最新抓取时间不变就复用，避免每次按需匹配都把全部 JD 读进内存。 */
function scoreContextCache(db: Db) {
  let cached: { key: string; ctx: Promise<ScoreContext> } | undefined;
  return async () => {
    const [s] = await db.select({ n: count(), latest: sql<string>`max(${t.fetchedAt})::text` }).from(t);
    const key = `${s?.n}|${s?.latest}`;
    if (cached?.key !== key) {
      const ctx = db
        .select(jobColumns)
        .from(t)
        .then((rows) => buildScoreContext(rows.map(rowToJob)));
      cached = { key, ctx };
      ctx.catch(() => {
        if (cached?.ctx === ctx) cached = undefined;
      });
    }
    return cached.ctx;
  };
}

async function loadFeedback(db: Db, userId: string) {
  const rows = await db
    .select({
      jobId: schema.feedback.jobId,
      signal: schema.feedback.signal,
      company: t.company,
      title: t.title,
    })
    .from(schema.feedback)
    .innerJoin(t, eq(t.id, schema.feedback.jobId))
    .where(eq(schema.feedback.userId, userId))
    .orderBy(schema.feedback.createdAt);
  const latest = new Map<
    string,
    { jobId: string; company: string; title: string; signal: "like" | "dislike" | "irrelevant" }
  >();
  for (const r of rows) if (r.signal !== "applied") latest.set(r.jobId, { ...r, signal: r.signal });
  return [...latest.values()];
}

export const jobsBrowseRoutes: RouteModule = (root, deps) => {
  root.register(async (app) => {
    const { db } = deps;
    const matching = createMatchingService(db, { llm: null, embedder: null });
    const scoreContext = scoreContextCache(db);

    app.setErrorHandler((error, req, reply) => {
      if (error instanceof z.ZodError) {
        return fail(reply, 400, "bad_request", error.issues.map((i) => i.message).join("；"));
      }
      req.log.error({ err: error }, "unhandled error");
      return fail(reply, 500, "internal_error", "服务器内部错误");
    });

    app.get("/api/v1/browse/jobs", async (req) => {
      const query = ListQuery.parse(req.query);
      const cond = where(req.userId, query);
      const order =
        query.sort === "match"
          ? [sql`${m.score} desc nulls last`, desc(recency), desc(t.id)]
          : [desc(recency), desc(t.id)];
      const [total, rows] = await Promise.all([
        db.select({ n: count() }).from(t).where(cond),
        db
          .select({ job: jobColumns, score: m.score })
          .from(t)
          .leftJoin(m, and(eq(m.jobId, t.id), eq(m.userId, req.userId), isNull(m.resumeVersionId)))
          .where(cond)
          .orderBy(...order)
          .limit(query.limit)
          .offset(query.offset),
      ]);
      const n = total[0]?.n ?? 0;
      const next = query.offset + rows.length;
      return {
        items: rows.map((r) => ({ job: summarize(rowToJob(r.job)), score: r.score })),
        total: n,
        nextOffset: rows.length === query.limit && next < n ? next : null,
      };
    });

    app.get("/api/v1/browse/facets", async (req) => {
      const f = Filters.parse(req.query);
      const uid = req.userId;
      const n = count();
      const cities = db
        .select({ value: sql<string>`unnest(${t.cities})`.as("value") })
        .from(t)
        .where(where(uid, f, "city"))
        .as("c");
      const [company, city, type, degree] = await Promise.all([
        db
          .select({ value: t.company, count: n })
          .from(t)
          .where(where(uid, f, "company"))
          .groupBy(t.company)
          .orderBy(desc(n), t.company)
          .limit(FACET_LIMIT),
        db
          .select({ value: cities.value, count: n })
          .from(cities)
          .groupBy(cities.value)
          .orderBy(desc(n), cities.value)
          .limit(FACET_LIMIT),
        db
          .select({ value: t.jobType, count: n })
          .from(t)
          .where(and(where(uid, f, "type"), sql`${t.jobType} is not null`))
          .groupBy(t.jobType)
          .orderBy(desc(n)),
        db
          .select({ value: degreeOf, count: n })
          .from(t)
          .where(where(uid, f, "degree"))
          .groupBy(degreeOf),
      ]);
      return { company, city, type, degree };
    });

    app.post<{ Params: { id: string } }>("/api/v1/browse/jobs/:id/match", async (req, reply) => {
      const uid = req.userId;
      const found = await loadJob(db, uid, req.params.id);
      if (!found) return fail(reply, 404, "job_not_found", "岗位不存在");

      const [profileRow] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, uid));
      if (!profileRow) {
        return fail(reply, 409, "profile_not_found", "还没有简历画像，先和助手聊一聊再来测匹配度");
      }
      const parsed = Profile.safeParse(profileRow.data);
      if (!parsed.success) return fail(reply, 422, "profile_invalid", "简历画像格式不正确");
      const profile = parsed.data;

      const [recommended] = (await matching.listMatches(uid, 1, found.job.id)).items;
      if (recommended) return { jobId: found.job.id, recommended: true, match: recommended };

      const [ctx, feedback] = await Promise.all([scoreContext(), loadFeedback(db, uid)]);
      const weights = (profileRow.weights ?? {}) as Partial<Weights>;
      const scored = scoreJob(profile, found.job, ctx, { weights, feedback });
      const filter = applyHardFilters(profile, found.job, { status: found.status });
      const excluded = !filter.pass && filter.reason ? filter.reason : undefined;
      return {
        jobId: found.job.id,
        recommended: false,
        match: {
          jobId: found.job.id,
          score: scored.score,
          dims: toDims(scored),
          report: {},
          reportStatus: "none",
          feedback: null,
          createdAt: new Date().toISOString(),
          job: summarize(found.job),
        },
        ...(excluded && {
          excluded: { reason: excluded, message: excludedMessage(excluded, profile, found.job) },
        }),
        belowThreshold: scored.baseScore < MIN_RECOMMEND_SCORE,
      };
    });
  });
};
