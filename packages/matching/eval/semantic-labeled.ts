// 在人工标注的 5 个画像 × 30 条岗位上，比较不同语义权重下的排序指标；每个画像只调用一次 rerank。
// 用法: RERANK_BASE_URL=... RERANK_MODEL=... [RERANK_API_KEY=...] node eval/semantic-labeled.ts [0,0.1,0.2,0.3,0.5,1]
import { matchProfile, readSeedJobs } from "../src/index.ts";
import {
  blendSemantic,
  calibrate,
  createRerankerFromEnv,
  rerankDocument,
  rerankQuery,
} from "../src/reranker.ts";
import type { ScoredJob } from "../src/types.ts";
import { CASES, POOL } from "./dataset.ts";
import { ndcgAtK, precisionAtK } from "./metrics.ts";

const reranker = createRerankerFromEnv();
if (!reranker) {
  console.error("需要 RERANK_BASE_URL 和 RERANK_MODEL");
  process.exit(2);
}
const weights = (process.argv[2] ?? "0,0.1,0.2,0.3,0.4,0.5,0.7,1").split(",").map(Number);
const modes = { 原始概率: (p: number) => p, 对数校准: calibrate } as const;
type Mode = keyof typeof modes;
const seed = readSeedJobs();
const pool = new Set(POOL);
const byScore = (a: ScoredJob, b: ScoredJob) => b.score - a.score || a.job.id.localeCompare(b.job.id);

const rows = new Map<string, { p5: number[]; strict: number[]; ndcg: number[] }>();
const row = (mode: Mode, w: number) => {
  const key = `${mode}\t${w}`;
  if (!rows.has(key)) rows.set(key, { p5: [], strict: [], ndcg: [] });
  return rows.get(key) as { p5: number[]; strict: number[]; ndcg: number[] };
};

for (const c of CASES) {
  const rel = (id: string) => c.labels[id]?.[0] ?? 0;
  const allRels = POOL.map(rel);
  const ranked = matchProfile(c.profile, seed, { recallLimit: seed.length }).matches.filter((m) =>
    pool.has(m.job.id),
  );
  const t = performance.now();
  const scores = await reranker.rerank(
    rerankQuery(c.profile),
    ranked.map((m) => rerankDocument(m.job)),
  );
  console.log(`\n${c.id}：rerank ${ranked.length} 条 ${(performance.now() - t).toFixed(0)}ms`);
  console.log("  规则分\t概率\t校准\t相关\t岗位");
  for (const [i, m] of ranked.entries()) {
    const p = scores[i] ?? 0;
    console.log(
      `  ${m.score.toFixed(1)}\t${p.toFixed(3)}\t${calibrate(p).toFixed(2)}\t${rel(m.job.id)}\t${m.job.company} ${m.job.title}`,
    );
  }
  for (const mode of Object.keys(modes) as Mode[]) {
    for (const w of weights) {
      const ids = ranked
        .map((m, i) => blendSemantic(m, modes[mode](scores[i] ?? 0), w))
        .sort(byScore)
        .map((m) => rel(m.job.id));
      const r = row(mode, w);
      r.p5.push(precisionAtK(ids, 5));
      r.strict.push(precisionAtK(ids, 5, 2));
      r.ndcg.push(ndcgAtK(ids, allRels, 10));
    }
  }
}

const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3);
console.log(`\n分数\t权重\tP@5\t严格P@5\tnDCG@10\t（逐画像 nDCG：${CASES.map((c) => c.id).join(" / ")}）`);
for (const [key, r] of rows) {
  console.log(
    `${key}\t${mean(r.p5)}\t${mean(r.strict)}\t${mean(r.ndcg)}\t${r.ndcg.map((n) => n.toFixed(2)).join(" / ")}`,
  );
}
