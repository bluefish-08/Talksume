import { bm25Rank, matchProfile, readSeedJobs } from "../src/index.ts";
import { CASES, POOL } from "./dataset.ts";
import { ndcgAtK, precisionAtK } from "./metrics.ts";

export interface CaseResult {
  id: string;
  feasible: number;
  relevant: number;
  rules: Metrics;
  bm25: Metrics;
  top5: { jobId: string; title: string; score: number; rel: number }[];
}

export interface Metrics {
  p5: number;
  strictP5: number;
  ndcg10: number;
}

function metricsFor(rankedIds: string[], rel: (id: string) => number, allRels: number[]): Metrics {
  const rels = rankedIds.map(rel);
  return {
    p5: precisionAtK(rels, 5),
    strictP5: precisionAtK(rels, 5, 2),
    ndcg10: ndcgAtK(rels, allRels, 10),
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** 用完整种子库建 IDF 与打分上下文，但只在 30 条标注池内比较排序。 */
export function evaluate() {
  const seed = readSeedJobs();
  const pool = new Set(POOL);
  const results: CaseResult[] = [];

  for (const c of CASES) {
    const rel = (id: string) => c.labels[id]?.[0] ?? 0;
    const allRels = POOL.map(rel);
    const outcome = matchProfile(c.profile, seed, { recallLimit: seed.length });
    const rulesRanked = outcome.matches.filter((m) => pool.has(m.job.id));
    const feasibleJobs = rulesRanked.map((m) => m.job);
    const bm25Ids = bm25Rank(c.profile, feasibleJobs).map((j) => j.id);

    results.push({
      id: c.id,
      feasible: rulesRanked.length,
      relevant: allRels.filter((r) => r > 0).length,
      rules: metricsFor(
        rulesRanked.map((m) => m.job.id),
        rel,
        allRels,
      ),
      bm25: metricsFor(bm25Ids, rel, allRels),
      top5: rulesRanked.slice(0, 5).map((m) => ({
        jobId: m.job.id,
        title: `${m.job.company} ${m.job.title}`,
        score: m.score,
        rel: rel(m.job.id),
      })),
    });
  }

  const avg = (pick: (r: CaseResult) => Metrics): Metrics => ({
    p5: mean(results.map((r) => pick(r).p5)),
    strictP5: mean(results.map((r) => pick(r).strictP5)),
    ndcg10: mean(results.map((r) => pick(r).ndcg10)),
  });
  return { cases: results, rules: avg((r) => r.rules), bm25: avg((r) => r.bm25) };
}
