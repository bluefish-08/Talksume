import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { Job } from "@talksume/core";
import { adapters, ingest, type JobType, mergeJobs } from "./index.ts";

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    limit: { type: "string", default: "300" },
    out: { type: "string" },
    type: { type: "string" },
    resume: { type: "boolean", default: false },
    newest: { type: "string" },
  },
});

const TYPES = ["internship", "campus", "experienced"];
const limit =
  values.limit === "all" || values.limit === "0" ? Number.POSITIVE_INFINITY : Number(values.limit);
const newest = values.newest === undefined ? undefined : Number(values.newest);
if (
  !values.source ||
  !values.out ||
  !(limit === Number.POSITIVE_INFINITY || (Number.isInteger(limit) && limit > 0)) ||
  (newest !== undefined && !(Number.isInteger(newest) && newest > 0)) ||
  (values.type && !TYPES.includes(values.type))
) {
  console.error(
    `用法: fetch --source <${Object.keys(adapters).join("|")}> --limit <数量|all> --out <文件.jsonl> [--type ${TYPES.join("|")}] [--resume] [--newest <数量>]`,
  );
  process.exit(2);
}
const outPath = values.out;

function readLines(path: string): Job[] {
  if (!existsSync(path)) return [];
  const jobs: Job[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    // 中断时最后一行可能只写了一半
    try {
      jobs.push(Job.parse(JSON.parse(line)));
    } catch {}
  }
  return jobs;
}

mkdirSync(dirname(outPath), { recursive: true });
const done = new Set(values.resume ? readLines(outPath).map((j) => j.id) : []);
if (values.resume) console.error(`[${values.source}] 续抓：已有 ${done.size} 条，跳过`);
const out = createWriteStream(outPath, { flags: values.resume ? "a" : "w" });
let ok = 0;
let errors = 0;
for await (const job of ingest({
  source: values.source,
  limit,
  ...(values.type ? { types: [values.type as JobType] } : {}),
  ...(done.size > 0 && { skip: (id: string) => done.has(id) }),
  onError: (m) => {
    errors++;
    console.error(`[warn] ${m}`);
  },
})) {
  out.write(`${JSON.stringify(job)}\n`);
  if (++ok % 25 === 0) console.error(`[${values.source}] ${ok}${Number.isFinite(limit) ? `/${limit}` : ""}`);
}
await new Promise<void>((r) => out.end(r));

let jobs = mergeJobs(readLines(outPath));
const merged = jobs.length;
if (newest !== undefined && jobs.length > newest) {
  // 截掉的岗位仍在招，入库时据此判断哪些是真下线
  writeFileSync(`${outPath}.ids`, jobs.map((j) => `${j.source}\t${j.sourceJobId}\n`).join(""));
  jobs = jobs.sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0)).slice(0, newest);
}
writeFileSync(`${outPath}.tmp`, jobs.map((j) => `${JSON.stringify(j)}\n`).join(""));
renameSync(`${outPath}.tmp`, outPath);
console.error(
  `[${values.source}] 完成：本次新抓 ${ok} 条，跳过/失败 ${errors} 处；合并后 ${merged} 条，写出 ${jobs.length} 条 -> ${outPath}`,
);
