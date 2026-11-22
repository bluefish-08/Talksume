import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { readJobs } from "./io.ts";
import { selectSeed } from "./seed.ts";
import { computeStats } from "./stats.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    size: { type: "string", default: "200" },
  },
});
if (positionals.length === 0 || !values.out) {
  console.error("用法: seed --out <文件.jsonl> [--size 200] <data/jobs/a.jsonl> [...]");
  process.exit(2);
}

const all = positionals.flatMap(readJobs);
const seed = selectSeed(all, { size: Number(values.size) });
mkdirSync(dirname(values.out), { recursive: true });
writeFileSync(values.out, seed.map((j) => `${JSON.stringify(j)}\n`).join(""));
const s = computeStats(seed);
console.error(`种子 ${s.total} 条 -> ${values.out}`);
console.error(
  JSON.stringify({ byType: s.byType, byRole: s.byRole, byCompany: s.byCompany, topCities: s.topCities }),
);
