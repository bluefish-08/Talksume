import { createDb, migrate } from "@talksume/db";
import { dedupeJobs } from "./dedupe.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("用法: DATABASE_URL=... dedupe");
  process.exit(2);
}

const handle = await createDb({ url: databaseUrl });
try {
  await migrate(handle);
  const r = await dedupeJobs(handle.db);
  console.error(`重复发布 ${r.groups} 组，标为重复 ${r.duplicates} 条，本次改动 ${r.changed} 行`);
} finally {
  await handle.close();
}
