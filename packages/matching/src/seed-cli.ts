import { createDb, migrate } from "@talksume/db";
import { createEmbedderFromEnv } from "./embedder.ts";
import { embedPendingJobs } from "./recall-db.ts";
import { seedJobs } from "./seed.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("缺少环境变量 DATABASE_URL");
  process.exit(2);
}

const seedPath = process.argv[2] || process.env.SEED_JOBS_PATH;
if (!seedPath) {
  console.error("用法: node src/seed-cli.ts <岗位.jsonl>（或设置 SEED_JOBS_PATH），文件可用 jobs-ingest 抓取");
  process.exit(2);
}

const handle = await createDb({ url: databaseUrl });
try {
  await migrate(handle);
  const n = await seedJobs(handle.db, seedPath);
  console.error(`已写入 ${n} 条岗位`);
  const embedder = createEmbedderFromEnv();
  if (embedder) console.error(`已生成 ${await embedPendingJobs(handle.db, embedder)} 条岗位向量`);
} finally {
  await handle.close();
}
