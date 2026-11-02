import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Job } from "@talksume/core";
import { createDb, migrate } from "@talksume/db";
import { createEmbedderFromEnv } from "./embedder.ts";
import { embedPendingJobs } from "./recall-db.ts";
import { syncCrawledJobs } from "./sync.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "close-missing": { type: "boolean", default: false },
    embed: { type: "boolean", default: false },
    "embed-delay": { type: "string", default: "200" },
  },
});
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || (positionals.length === 0 && !values.embed)) {
  console.error(
    "用法: DATABASE_URL=... sync [--close-missing] [--embed] [--embed-delay 毫秒] <data/jobs/*.jsonl>",
  );
  process.exit(2);
}

const jobs: Job[] = [];
const online = new Map<string, Set<string>>();
const markOnline = (source: string, id: string) => {
  const set = online.get(source) ?? new Set<string>();
  set.add(id);
  online.set(source, set);
};
for (const file of positionals) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const job = Job.parse(JSON.parse(line));
    jobs.push(job);
    markOnline(job.source, job.sourceJobId);
  }
  // fetch --newest 截断时留下的全量在招清单
  if (existsSync(`${file}.ids`)) {
    for (const line of readFileSync(`${file}.ids`, "utf8").split("\n")) {
      const [source, id] = line.split("\t");
      if (source && id) markOnline(source, id);
    }
  }
}

const handle = await createDb({ url: databaseUrl });
try {
  await migrate(handle);
  if (jobs.length > 0) {
    const r = await syncCrawledJobs(handle.db, jobs, values["close-missing"] ? online : undefined);
    console.error(`已写入 ${r.upserted} 条岗位；标为下线 ${JSON.stringify(r.closed)}`);
  }
  const embedder = values.embed ? createEmbedderFromEnv() : undefined;
  if (values.embed && !embedder) console.error("未配置 EMBEDDING_BASE_URL / EMBEDDING_MODEL，跳过向量");
  if (embedder) {
    const delayMs = Number(values["embed-delay"]);
    const n = await embedPendingJobs(handle.db, embedder, 32, {
      delayMs,
      onBatch: (done) => console.error(`向量 ${done}`),
    });
    console.error(`已生成 ${n} 条岗位向量`);
  }
} finally {
  await handle.close();
}
