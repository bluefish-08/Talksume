import type { JobCard, JobInsight, JobTools, ResumeTailor, TailorCard } from "@talksume/agent";
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
import {
  generateTailoring,
  loadTailoring,
  revokeTailoring,
  selectTailoring,
  TailorError,
  type TailoringSnapshot,
  usable,
} from "./tailor-store.ts";

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
const CARD_SECTION_LABEL = { experiences: "实习经历", projects: "项目经历", campus: "校园经历" } as const;

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

const clip = (text: string, limit = 40) =>
  text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;

function cardTitle(change: TailorChange): string {
  if (change.kind === "summary") return "摘要";
  if (change.kind === "skill_order") return "技能";
  if (change.kind === "item_order") return CARD_SECTION_LABEL[change.section];
  return change.heading;
}

function cardSummary(change: TailorChange): string {
  if (change.kind === "summary") return clip(change.reason ?? "补一句和岗位相关的个人摘要");
  if (change.kind === "bullet") return clip(change.reason ?? "措辞更贴近岗位");
  if (change.kind === "bullet_order") return clip(`把「${change.after[0] ?? ""}」提到第一条`);
  if (change.kind === "item_order") return clip(`${change.after[0] ?? ""} 排前面`);
  return clip(`${change.after.slice(0, 2).join("、")} 提前`);
}

function changeLabelData(change: TailorChange) {
  if (change.kind === "summary")
    return { kind: change.kind, hadBefore: Boolean(change.before?.trim()) } as const;
  if (change.kind === "bullet")
    return { kind: change.kind, name: clip(change.before.replace(/^[•\-\s]+/, ""), 12) } as const;
  if (change.kind === "bullet_order")
    return {
      kind: change.kind,
      name: clip(change.after[0] ?? change.heading, 12),
      order: change.after,
    } as const;
  if (change.kind === "skill_order")
    return { kind: change.kind, order: change.after, orderBefore: change.before } as const;
  return { kind: change.kind, name: clip(change.after[0] ?? "", 12), order: change.after } as const;
}

function tailorCardOf(
  snapshot: Pick<TailoringSnapshot, "job" | "changes" | "selected">,
  extra: Pick<TailorCard, "level" | "kind" | "status"> = {},
): TailorCard {
  const usableChanges = snapshot.changes.filter(usable);
  const chosen =
    snapshot.selected.length > 0 ? new Set(snapshot.selected) : new Set(usableChanges.map((c) => c.id));
  const numbers = new Map(usableChanges.map((c, i) => [c.id, i + 1]));
  const items = snapshot.changes.map((change) => {
    const number = numbers.get(change.id);
    const blocked = !number;
    return {
      id: change.id,
      ...(number ? { number } : {}),
      title: cardTitle(change),
      summary: cardSummary(change),
      selected: !blocked && chosen.has(change.id),
      blocked,
      ...changeLabelData(change),
      ...(blocked && { violations: change.violations }),
    };
  });
  return {
    jobId: snapshot.job.id,
    company: snapshot.job.company,
    title: snapshot.job.title,
    ...(extra.level && { level: extra.level }),
    ...(extra.kind && { kind: extra.kind }),
    ...(extra.status && { status: extra.status }),
    changes: usableChanges.length,
    rejected: snapshot.changes.length - usableChanges.length,
    items,
  };
}

function itemLine(item: NonNullable<TailorCard["items"]>[number]): string {
  if (item.blocked)
    return `- ${item.title} [${item.id}]：不能选（没改：${(item.violations ?? []).join("、")} 你没说过）`;
  return `- ${item.number}. ${item.title} [${item.id}]：${item.selected ? "已选" : "未选"} · ${item.summary}`;
}

export function storeResumeTailor(
  db: Db,
  llm: StructuredLlm,
  userId: string,
  conversationId?: string,
): ResumeTailor {
  return {
    async tailor(profile, facts, jobId, level) {
      const quotes = facts.map((f) => f.quote).filter(Boolean);
      const result = await generateTailoring(db, llm, userId, jobId, {
        profile,
        quotes,
        ...(level && { level }),
        ...(conversationId && { conversationId }),
      }).catch((error: unknown) => {
        if (error instanceof TailorError && error.code === "job_not_found") return null;
        throw error;
      });
      if (!result) return null;
      if (result.kept) {
        const usableChanges = result.kept.changes.filter(usable);
        const status = result.kept.adopted ? "adopted" : result.kept.revoked ? "revoked" : "draft";
        return {
          card: tailorCardOf(
            { job: result.job, changes: result.kept.changes, selected: result.kept.selected },
            { level: result.level, kind: "update", status },
          ),
          lines: usableChanges.map(describeTailorChange),
          kept: { changes: usableChanges.length, status },
        };
      }
      const snapshot = { job: result.job, changes: result.changes, selected: [] };
      const card = tailorCardOf(snapshot, { level: result.level, kind: "generation", status: "draft" });
      return {
        card,
        lines: result.changes.filter(usable).map(describeTailorChange),
      };
    },

    async select(jobId, options) {
      const result = await selectTailoring(db, userId, jobId, options).catch((error: unknown) => {
        if (error instanceof TailorError && error.code === "not_found") return null;
        throw error;
      });
      if (!result) return null;
      const card = tailorCardOf(result, {
        kind: "update",
        status: options.adopt ? "adopted" : "draft",
      });
      const notes = [
        result.unknown.length > 0 ? `找不到这些改动 id：${result.unknown.join("、")}，没有改它们。` : "",
        result.refused.length > 0 ? `${result.refused.join("、")} 是被拦下的改动，不能选，已经忽略。` : "",
        options.adopt ? "采用成功。" : "",
      ].filter(Boolean);
      return {
        card,
        lines: (card.items ?? []).map(itemLine),
        ...(notes.length > 0 && { notes }),
      };
    },

    async revoke(jobId) {
      await revokeTailoring(db, userId, jobId);
      const snapshot = await loadTailoring(db, userId, jobId).catch((error: unknown) => {
        if (error instanceof TailorError && error.code === "job_not_found") return null;
        throw error;
      });
      if (!snapshot) return null;
      return { card: tailorCardOf(snapshot, { kind: "update", status: "revoked" }), lines: [] };
    },
  };
}
