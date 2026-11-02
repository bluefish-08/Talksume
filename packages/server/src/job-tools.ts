import type { JobCard, JobTools } from "@talksume/agent";
import {
  DIMENSION_LABELS,
  DIMENSIONS,
  type JobSummary,
  type MatchDims,
  type MatchingService,
} from "@talksume/matching";

function toCard(job: JobSummary, score: number, reason: string | undefined): JobCard {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    cities: job.cities,
    ...(job.jobType && { jobType: job.jobType }),
    score: Math.round(score),
    ...(reason && { reason }),
  };
}

const STRONG = 0.6;
const WEAK = 0.4;

const coreDims = (dims: MatchDims) =>
  DIMENSIONS.flatMap((key) => {
    const d = dims[key];
    return d && (d.weight ?? 0) > 0 ? [{ key, ...d, weight: d.weight ?? 0 }] : [];
  });

const stripQuotes = (evidence: string) => evidence.replace(/；?JD「[^」]*」/g, "");

/** 没有 AI 报告时用规则证据拼一句理由：方向是否对口、命中了哪些技能。 */
export function reasonFromDims(dims: MatchDims): string | undefined {
  const hits = (dims.skills?.evidence ?? []).flatMap(
    (e) => /^命中 (.+?)：/.exec(e)?.[1]?.replace(/ 任一$/, "") ?? [],
  );
  const parts = [
    ...((dims.role?.score ?? 0) >= STRONG ? ["方向对口"] : []),
    ...(hits.length > 0 ? [`技能命中 ${hits.slice(0, 3).join("、")}`] : []),
  ];
  if (parts.length > 0) return parts.join("，");
  const best = coreDims(dims).sort((a, b) => b.score * b.weight - a.score * a.weight)[0];
  const evidence = best?.evidence?.[0];
  return evidence && stripQuotes(evidence);
}

export function matchingJobTools(service: MatchingService, userId: string): JobTools {
  return {
    async recommend(profile, query) {
      const r = await service.recommendFor(userId, profile, query);
      return {
        jobs: r.items.map((m) => toCard(m.job, m.score, m.report.summary ?? reasonFromDims(m.dims))),
        total: r.total,
        ...(r.hint && { hint: r.hint }),
      };
    },

    async search(profile, query) {
      const r = await service.searchFor(userId, profile, {
        q: query.query,
        ...(query.company && { company: query.company }),
        ...(query.city && { city: query.city }),
        ...(query.jobType && { jobType: query.jobType }),
        limit: query.limit,
      });
      return { jobs: r.items.map((i) => toCard(i.job, i.score, reasonFromDims(i.dims))), total: r.total };
    },

    async explain(profile, jobId) {
      const r = await service.explainFor(userId, profile, jobId);
      if (!r) return null;
      const dims = coreDims(r.dims);
      const evidenceOf = (d: (typeof dims)[number]) => (d.evidence?.[0] ? [stripQuotes(d.evidence[0])] : []);
      return {
        job: toCard(r.job, r.score, r.report?.summary),
        ...(r.report?.summary && { summary: r.report.summary }),
        strengths: r.report?.strengths ?? dims.filter((d) => d.score >= STRONG).flatMap(evidenceOf),
        gaps: r.report?.gaps ?? dims.filter((d) => d.score < WEAK).flatMap(evidenceOf),
        dims: dims.map((d) => ({
          label: DIMENSION_LABELS[d.key],
          score: Math.round(d.score * 100),
          evidence: d.evidence ?? [],
        })),
        ...(r.blocked && { blocked: r.blocked }),
      };
    },
  };
}
