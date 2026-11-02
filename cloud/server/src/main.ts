import { createDb, migrate } from "@talksume/db";
import { createGateway, type LlmCallLog, loadGatewayConfig } from "@talksume/llm-gateway";
import { createEmbedderFromEnv, embedPendingJobs, seedJobsIfEmpty } from "@talksume/matching";
import {
  buildApp,
  createRedisNotifier,
  InProcessNotifier,
  type NotificationBus,
  runReminderSweep,
} from "@talksume/server";

const databaseUrl = process.env.DATABASE_URL;
const database = databaseUrl ? await createDb({ url: databaseUrl }) : undefined;
if (database) {
  await migrate(database);
  const seeded = await seedJobsIfEmpty(database.db);
  if (seeded > 0) console.log(`已写入 ${seeded} 条种子岗位`);
  const embedder = createEmbedderFromEnv();
  if (embedder) {
    void embedPendingJobs(database.db, embedder).catch((err: unknown) =>
      console.error("岗位向量生成失败", err instanceof Error ? err.message : err),
    );
  }
}

let logCall: (log: LlmCallLog) => void = () => {};
const gateway = process.env.LLM_API_KEY
  ? createGateway(loadGatewayConfig(), { onLog: (log) => logCall(log) })
  : undefined;

const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? await createRedisNotifier(redisUrl) : undefined;
const notifier: NotificationBus = redis?.notifier ?? new InProcessNotifier();

const app = buildApp({
  edition: "cloud",
  version: process.env.APP_VERSION ?? "dev",
  logger: true,
  flow: { notifier },
  ...(database && { db: database.db }),
  ...(gateway && { llm: { streamFn: gateway.streamFn("intake"), model: gateway.primaryModel } }),
});
logCall = (log) => app.log.info({ llm: log }, "llm call");
if (!gateway) app.log.warn("LLM_API_KEY 未设置，对话接口将返回 503");

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const sweep = () =>
  database
    ? runReminderSweep(database.db, new Date(), notifier).catch((err: unknown) =>
        app.log.error(err, "reminder sweep failed"),
      )
    : undefined;
void sweep();
const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);

const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: "0.0.0.0", port });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(
    signal,
    () =>
      void (async () => {
        clearInterval(sweepTimer);
        await app.close();
        await redis?.close();
        await database?.close();
        process.exit(0);
      })(),
  );
}
