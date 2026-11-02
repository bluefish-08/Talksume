import type { Job, Profile } from "@talksume/core";
import {
  type ScoreContext,
  scoreCity,
  scoreExperience,
  scoreMajor,
  scoreRole,
  scoreSkills,
} from "./dimensions.ts";
import { applyHardFilters } from "./filters.ts";
import { levelAdjustment } from "./level.ts";
import { classifyRole, ROLE_LABELS } from "./role.ts";
import { Bm25, buildIdf, clamp01, tokenize } from "./text.ts";
import {
  CONTEXT_DIMENSIONS,
  CORE_DIMENSIONS,
  DEFAULT_WEIGHTS,
  DIMENSIONS,
  type DimensionKey,
  type DimensionScores,
  type FeedbackEntry,
  type FilterReason,
  type MatchOptions,
  type MatchOutcome,
  type ScoredJob,
  type Weights,
} from "./types.ts";

// 8000+ 岗位库实测：100 时全量打分的前 10 只召回 8 个，500 时前 20 全中、耗时只多约 80ms
export const DEFAULT_RECALL_LIMIT = 500;
/** 规则分低于此值的岗位只是「专业/城市沾边」，不推荐给用户。 */
export const MIN_RECOMMEND_SCORE = 30;

const jobText = (job: Job) => `${job.title}\n${job.title}\n${job.jdText}`;

export function buildScoreContext(jobs: Job[]): ScoreContext {
  return { idf: buildIdf(jobs.map((j) => tokenize(jobText(j)))) };
}

export function mergeWeights(overrides: Partial<Weights> = {}): Weights {
  const merged = { ...DEFAULT_WEIGHTS };
  for (const key of DIMENSIONS) {
    const v = overrides[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) merged[key] = v;
  }
  return merged;
}

export function scoreDimensions(profile: Profile, job: Job, ctx: ScoreContext): DimensionScores {
  return {
    skills: scoreSkills(profile, job),
    role: scoreRole(profile, job),
    experience: scoreExperience(profile, job, ctx),
    major: scoreMajor(profile, job),
    city: scoreCity(profile, job),
  };
}

/** 不适用的维度权重归零，其余按比例放大，使总权重仍为 1。 */
export function effectiveWeights(dims: DimensionScores, weights: Weights): Weights {
  const active = DIMENSIONS.filter((k) => dims[k].applicable);
  const sum = active.reduce((s, k) => s + weights[k], 0);
  const out = { ...weights };
  for (const k of DIMENSIONS) out[k] = dims[k].applicable && sum > 0 ? weights[k] / sum : 0;
  return out;
}

const FAMILY_PENALTY = { dislike: 0.7, irrelevant: 0.6 } as const;
const SELF_PENALTY = 0.3;
const FAMILY_BOOST = 1.05;

function familyKey(job: Pick<Job, "company" | "title">): string {
  return `${job.company}|${classifyRole(job.title)}`;
}

/** 同公司同岗位类别：不感兴趣/无关降权，感兴趣小幅加权；本岗位自己被否定时压得更狠。 */
export function feedbackAdjustment(
  job: Pick<Job, "id" | "company" | "title">,
  feedback: FeedbackEntry[],
): { multiplier: number; evidence: string[] } {
  const key = familyKey(job);
  let penalty = 1;
  let boost = 1;
  let penaltyNote: string | undefined;
  let boostNote: string | undefined;
  for (const f of feedback) {
    const same = f.jobId === job.id;
    if (!same && familyKey(f) !== key) continue;
    const label = `${f.company}「${ROLE_LABELS[classifyRole(f.title)]}」类岗位`;
    if (f.signal === "like") {
      if (!same) {
        boost = FAMILY_BOOST;
        boostNote = `你对${label}标记过感兴趣，小幅加权`;
      }
      continue;
    }
    const factor = same ? SELF_PENALTY : FAMILY_PENALTY[f.signal];
    if (factor < penalty) {
      penalty = factor;
      const verb = f.signal === "dislike" ? "不感兴趣" : "不相关";
      penaltyNote = same ? `你已将本岗位标记为${verb}，大幅降权` : `你对${label}标记过${verb}，同类岗位降权`;
    }
  }
  if (penaltyNote) return { multiplier: penalty, evidence: [penaltyNote] };
  return { multiplier: boost, evidence: boostNote ? [boostNote] : [] };
}

/** JD 技能清单通常很长，覆盖一半就算相当对口，取 0.6 次方让覆盖率的边际收益递减。 */
export const SKILL_CURVE = 0.6;

/** 85 分以上压缩，满分匹配落在 94–95 而不是贴着 100，给后续的加权留出区分度。 */
function softCeiling(score: number): number {
  return score <= 85 ? score : 85 + (score - 85) * 0.65;
}

/** 核心维度加权得相关度，再按专业/城市的契合度打折；没有核心维度时退回整体加权。 */
export function combineDimensions(dims: DimensionScores, weights: Weights): number {
  const credit = (k: DimensionKey) => (k === "skills" ? dims.skills.score ** SKILL_CURVE : dims[k].score);
  const part = (keys: readonly DimensionKey[]) => {
    const w = keys.reduce((s, k) => s + weights[k], 0);
    return { w, avg: w > 0 ? keys.reduce((s, k) => s + weights[k] * credit(k), 0) / w : 0 };
  };
  const core = part(CORE_DIMENSIONS);
  const context = part(CONTEXT_DIMENSIONS);
  if (core.w <= 0) return DIMENSIONS.reduce((s, k) => s + weights[k] * credit(k), 0);
  return core.avg * (1 - context.w + context.w * context.avg);
}

export function scoreJob(
  profile: Profile,
  job: Job,
  ctx: ScoreContext,
  opts: Pick<MatchOptions, "weights" | "feedback"> = {},
): ScoredJob {
  const dims = scoreDimensions(profile, job, ctx);
  const weights = effectiveWeights(dims, mergeWeights(opts.weights));
  const level = levelAdjustment(profile, job);
  if (level.evidence)
    dims.experience = { ...dims.experience, evidence: [level.evidence, ...dims.experience.evidence] };
  const base = softCeiling(combineDimensions(dims, weights) * level.multiplier * 100);
  const adj = feedbackAdjustment(job, opts.feedback ?? []);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    job,
    score: round(Math.min(100, Math.max(0, base * adj.multiplier))),
    baseScore: round(base),
    dims,
    weights,
    feedbackMultiplier: adj.multiplier,
    feedbackEvidence: adj.evidence,
    levelMultiplier: level.multiplier,
  };
}

/** 召回用的查询文本：意向岗位重复几次提高权重，再拼技能、专业和经历。 */
export function profileQueryText(profile: Profile): string {
  const roles = profile.intention.roles.join(" ");
  return [
    roles,
    roles,
    roles,
    profile.skills.map((s) => s.name).join(" "),
    profile.education.map((e) => e.major ?? "").join(" "),
    profile.experiences.map((e) => `${e.title} ${e.bullets.join(" ")}`).join(" "),
    profile.projects.map((p) => `${p.name} ${p.techStack.join(" ")} ${p.action ?? ""}`).join(" "),
  ].join("\n");
}

function normalize(values: number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 ? v / max : 0));
}

export function recall(
  profile: Profile,
  jobs: Job[],
  limit: number,
  vectorScores?: Map<string, number>,
): Job[] {
  if (jobs.length <= limit) return jobs;
  const bm25 = new Bm25(jobs.map((j) => tokenize(jobText(j))));
  const query = tokenize(profileQueryText(profile));
  const lexical = normalize(jobs.map((_, i) => bm25.score(query, i)));
  const hasVectors = vectorScores !== undefined && vectorScores.size > 0;
  // 没进向量近邻或还没算向量的岗位按已知最低相似度计，避免向量补到一半时整体被压到底
  const floor = hasVectors ? Math.min(...vectorScores.values()) : 0;
  const vector = hasVectors ? jobs.map((j) => clamp01(vectorScores.get(j.id) ?? floor)) : [];
  const ranked = jobs.map((job, i) => ({
    job,
    s: hasVectors ? 0.7 * (vector[i] ?? 0) + 0.3 * (lexical[i] ?? 0) : (lexical[i] ?? 0),
  }));
  ranked.sort((a, b) => b.s - a.s || a.job.id.localeCompare(b.job.id));
  return ranked.slice(0, limit).map((r) => r.job);
}

/** 只按 BM25 对岗位排序，评测时作为对照基线。 */
export function bm25Rank(profile: Profile, jobs: Job[]): Job[] {
  const bm25 = new Bm25(jobs.map((j) => tokenize(jobText(j))));
  const query = tokenize(profileQueryText(profile));
  return jobs
    .map((job, i) => ({ job, s: bm25.score(query, i) }))
    .sort((a, b) => b.s - a.s || a.job.id.localeCompare(b.job.id))
    .map((r) => r.job);
}

export interface Candidate {
  job: Job;
  status?: string;
}

export function matchProfile(
  profile: Profile,
  candidates: (Job | Candidate)[],
  opts: MatchOptions = {},
): MatchOutcome {
  const all = candidates.map((c) => ("job" in c ? c : { job: c }));
  const excluded: Record<FilterReason, number> = { jobType: 0, city: 0, degree: 0, closed: 0 };
  const passed: Job[] = [];
  for (const { job, status } of all) {
    const res = applyHardFilters(profile, job, {
      ...(opts.strictCity !== undefined && { strictCity: opts.strictCity }),
      ...(status && { status }),
    });
    if (res.pass) passed.push(job);
    else if (res.reason) excluded[res.reason]++;
  }

  const ctx = buildScoreContext(all.map((c) => c.job));
  const recalled = recall(profile, passed, opts.recallLimit ?? DEFAULT_RECALL_LIMIT, opts.vectorScores);
  const matches = recalled
    .map((job) =>
      scoreJob(profile, job, ctx, {
        ...(opts.weights && { weights: opts.weights }),
        ...(opts.feedback && { feedback: opts.feedback }),
      }),
    )
    .sort((a, b) => b.score - a.score || a.job.id.localeCompare(b.job.id));
  const relevant = matches.filter((m) => m.baseScore >= (opts.minScore ?? 0));
  return {
    matches: relevant,
    belowThreshold: matches.length - relevant.length,
    excluded,
    candidates: passed.length,
    recalled: recalled.length,
  };
}
