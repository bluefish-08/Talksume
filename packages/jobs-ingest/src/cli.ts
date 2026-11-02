import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { adapters, ingest, type JobType } from "./index.ts";

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    limit: { type: "string", default: "300" },
    out: { type: "string" },
    type: { type: "string" },
  },
});

const TYPES = ["internship", "campus", "experienced"];
const limit = Number(values.limit);
if (
  !values.source ||
  !values.out ||
  !Number.isInteger(limit) ||
  limit <= 0 ||
  (values.type && !TYPES.includes(values.type))
) {
  console.error(
    `用法: fetch --source <${Object.keys(adapters).join("|")}> --limit <数量> --out <文件.jsonl> [--type ${TYPES.join("|")}]`,
  );
  process.exit(2);
}

mkdirSync(dirname(values.out), { recursive: true });
const out = createWriteStream(values.out);
let ok = 0;
let errors = 0;
for await (const job of ingest({
  source: values.source,
  limit,
  ...(values.type ? { types: [values.type as JobType] } : {}),
  onError: (m) => {
    errors++;
    console.error(`[warn] ${m}`);
  },
})) {
  out.write(`${JSON.stringify(job)}\n`);
  if (++ok % 25 === 0) console.error(`[${values.source}] ${ok}/${limit}`);
}
await new Promise<void>((r) => out.end(r));
console.error(`[${values.source}] 完成 ${ok} 条，跳过/失败 ${errors} 处 -> ${values.out}`);
