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
import { classifyRole, ROLE_LABELS } from "./role.ts";
import { Bm25, buildIdf, clamp01, tokenize } from "./text.ts";
import {
  DEFAULT_WEIGHTS,
  DIMENSIONS,
  type DimensionScores,
  type FeedbackEntry,
  type FilterReason,
  type MatchOptions,
  type MatchOutcome,
  type ScoredJob,
  type Weights,
} from "./types.ts";

export const DEFAULT_RECALL_LIMIT = 100;

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

export function scoreJob(
  profile: Profile,
  job: Job,
  ctx: ScoreContext,
  opts: Pick<MatchOptions, "weights" | "feedback"> = {},
): ScoredJob {
  const dims = scoreDimensions(profile, job, ctx);
  const weights = effectiveWeights(dims, mergeWeights(opts.weights));
  const base = DIMENSIONS.reduce((s, k) => s + weights[k] * dims[k].score, 0) * 100;
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
  const vector = hasVectors ? jobs.map((j) => clamp01(vectorScores.get(j.id) ?? 0)) : [];
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
  return { matches, excluded, candidates: passed.length, recalled: recalled.length };
}
