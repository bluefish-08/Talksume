import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { toolGateway, Usage } from "../lib/llm.ts";
import { pool } from "../lib/stats.ts";
import { loadEnv } from "../lib/target.ts";
import { type ClaimInput, judgeClaim } from "./judge.ts";

interface Sample extends ClaimInput {
  id: string;
  source: string;
  label: boolean;
  note: string;
}

const { values } = parseArgs({
  options: {
    samples: { type: "string", default: new URL("./claim-samples.jsonl", import.meta.url).pathname },
    reps: { type: "string", default: "3" },
    out: { type: "string" },
  },
});
loadEnv();
const samples = readFileSync(values.samples, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Sample);
const usage = new Usage();
const gw = toolGateway(usage);
const reps = Number(values.reps);
const jobs = samples.flatMap((s) => Array.from({ length: reps }, () => s));
const verdicts = await pool(jobs, 6, async (s) => ({ s, v: await judgeClaim(gw, s) }));

const byId = new Map<string, boolean[]>();
for (const { s, v } of verdicts) byId.set(s.id, [...(byId.get(s.id) ?? []), v.falseClaim]);
let tp = 0;
let fp = 0;
let fn = 0;
let tn = 0;
let unstable = 0;
const rows: string[] = [];
for (const s of samples) {
  const votes = byId.get(s.id) ?? [];
  const yes = votes.filter(Boolean).length;
  if (yes > 0 && yes < votes.length) unstable++;
  const pred = yes * 2 > votes.length;
  if (pred && s.label) tp++;
  else if (pred) fp++;
  else if (s.label) fn++;
  else tn++;
  const mark = pred === s.label ? "" : " ✗";
  rows.push(
    `| ${s.id} | ${s.source} | ${s.reply.replace(/\n/g, " ").slice(0, 70)} | ${s.writes.length} | ${s.label ? "假称" : "否"} | ${yes}/${votes.length}${mark} | ${s.note} |`,
  );
}
const n = samples.length;
const md = [
  "# 假称判定器校准",
  "",
  `${n} 条样本 × ${reps} 次（temperature 0，多数票）。准确率 ${(((tp + tn) / n) * 100).toFixed(1)}%，查准 ${tp}/${tp + fp}，查全 ${tp}/${tp + fn}，${reps} 次判定不一致 ${unstable} 条。`,
  "",
  "| id | 来源 | 回复（节选） | 本轮写入条数 | 标注 | 判为假称 | 标注理由 |",
  "|---|---|---|---|---|---|---|",
  ...rows,
  "",
  `token：${JSON.stringify(usage.total())}`,
].join("\n");
console.log(md);
if (values.out) writeFileSync(values.out, md);
