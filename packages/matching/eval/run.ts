import { evaluate } from "./evaluate.ts";

const fmt = (n: number) => n.toFixed(2);
const report = evaluate();

console.log("画像\t\t\t可排序\t相关\t规则 P@5\t严格 P@5\t规则 nDCG@10\tBM25 P@5\tBM25 nDCG@10");
for (const c of report.cases) {
  console.log(
    [
      c.id.padEnd(22),
      c.feasible,
      c.relevant,
      fmt(c.rules.p5),
      fmt(c.rules.strictP5),
      fmt(c.rules.ndcg10),
      fmt(c.bm25.p5),
      fmt(c.bm25.ndcg10),
    ].join("\t"),
  );
}
console.log(
  [
    "平均".padEnd(22),
    "",
    "",
    fmt(report.rules.p5),
    fmt(report.rules.strictP5),
    fmt(report.rules.ndcg10),
    fmt(report.bm25.p5),
    fmt(report.bm25.ndcg10),
  ].join("\t"),
);

if (process.argv.includes("--top")) {
  for (const c of report.cases) {
    console.log(`\n${c.id}`);
    for (const t of c.top5) console.log(`  ${t.score.toFixed(1)}\trel=${t.rel}\t${t.title}`);
  }
}
