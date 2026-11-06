import type { JobCard, JobInsight, JobTools, ResumeTailor } from "@talksume/agent";
import type { TailorChange } from "@talksume/core";
import type { Db } from "@talksume/db";
import {
  DIMENSION_LABELS,
  DIMENSIONS,
  type JobSummary,
  type MatchDims,
  type MatchExplanation,
  type MatchingService,
  summarizeKeywords,
} from "@talksume/matching";
import type { StructuredLlm } from "./polish-llm.ts";
import { generateTailoring, TailorError, usable } from "./tailor-store.ts";

function toCard(
  job: JobSummary,
  score: number,
  reason: string | undefined,
  explanation?: MatchExplanation,
): JobCard {
  const matchKeywords = explanation && summarizeKeywords(explanation);
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    cities: job.cities,
    ...(job.jobType && { jobType: job.jobType }),
    score: Math.round(score),
    ...(reason && { reason }),
    ...(matchKeywords &&
      (matchKeywords.have.length > 0 || matchKeywords.missing.length > 0) && { matchKeywords }),
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
  const lines = dims.skills?.evidence ?? [];
  const hits = lines.flatMap((e) => /^命中 (.+?)(?:（[^）]*）)?：/.exec(e)?.[1] ?? []);
  const coverage = lines.map((e) => /^满足 (\d+\/\d+) 项技能要求/.exec(e)?.[1]).find(Boolean);
  const parts = [
    ...((dims.role?.score ?? 0) >= STRONG ? ["方向对口"] : []),
    ...(hits.length > 0
      ? [`技能命中 ${hits.slice(0, 3).join("、")}${coverage ? `（满足 ${coverage} 项要求）` : ""}`]
      : []),
  ];
  if (parts.length > 0) return parts.join("，");
  const best = coreDims(dims).sort((a, b) => b.score * b.weight - a.score * a.weight)[0];
  const evidence = best?.evidence?.[0];
  return evidence && stripQuotes(evidence);
}

function breakdownOf(e: MatchExplanation): NonNullable<JobInsight["breakdown"]> {
  const keyword = ({ name, status, source }: MatchExplanation["required"][number]) => ({
    name,
    status,
    ...(source && { source }),
  });
  return {
    score: e.score,
    components: e.components.map(({ label, score, weight, applicable, note }) => ({
      label,
      score,
      weight,
      applicable,
      note,
    })),
    required: e.required.map(keyword),
    bonus: e.bonus.map(keyword),
    concepts: e.concepts.map(keyword),
  };
}

export function matchingJobTools(service: MatchingService, userId: string): JobTools {
  return {
    async recommend(profile, query) {
      const r = await service.recommendFor(userId, profile, query);
      const ex = await service.explainMatches(
        userId,
        profile,
        r.items.map((m) => m.jobId),
      );
      return {
        jobs: r.items.map((m) =>
          toCard(m.job, m.score, m.report.summary ?? reasonFromDims(m.dims), ex.get(m.jobId)),
        ),
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
      const ex = await service.explainMatches(
        userId,
        profile,
        r.items.map((i) => i.job.id),
      );
      return {
        jobs: r.items.map((i) => toCard(i.job, i.score, reasonFromDims(i.dims), ex.get(i.job.id))),
        total: r.total,
      };
    },

    async explain(profile, jobId) {
      const [r, ex] = await Promise.all([
        service.explainFor(userId, profile, jobId),
        service.explainMatches(userId, profile, [jobId]),
      ]);
      if (!r) return null;
      const explanation = ex.get(jobId);
      const dims = coreDims(r.dims);
      const evidenceOf = (d: (typeof dims)[number]) => (d.evidence?.[0] ? [stripQuotes(d.evidence[0])] : []);
      return {
        job: toCard(r.job, r.score, r.report?.summary, explanation),
        ...(explanation && { breakdown: breakdownOf(explanation) }),
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

const ITEM_SECTION_LABEL = { experiences: "经历", projects: "项目", campus: "校园经历" } as const;

export function describeTailorChange(change: TailorChange): string {
  switch (change.kind) {
    case "summary":
      return `- 个人摘要：${change.after}`;
    case "bullet":
      return `- 「${change.heading}」要点：${change.before} → ${change.after}`;
    case "bullet_order":
      return `- 「${change.heading}」要点顺序：把「${change.after[0] ?? ""}」放到最前`;
    case "item_order":
      return `- ${ITEM_SECTION_LABEL[change.section]}顺序：${change.after.join(" → ")}`;
    case "skill_order":
      return `- 技能展示顺序：${change.after.slice(0, 5).join("、")} 排在前面`;
  }
}

export function storeResumeTailor(db: Db, llm: StructuredLlm, userId: string): ResumeTailor {
  return {
    async tailor(profile, facts, jobId, level) {
      const quotes = facts.map((f) => f.quote).filter(Boolean);
      const result = await generateTailoring(db, llm, userId, jobId, {
        profile,
        quotes,
        ...(level && { level }),
      }).catch((error: unknown) => {
        if (error instanceof TailorError && error.code === "job_not_found") return null;
        throw error;
      });
      if (!result) return null;
      const ok = result.changes.filter(usable);
      return {
        card: {
          jobId: result.job.id,
          company: result.job.company,
          title: result.job.title,
          changes: ok.length,
          rejected: result.changes.length - ok.length,
        },
        lines: ok.map(describeTailorChange),
      };
    },
  };
}
