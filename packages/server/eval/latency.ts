// 每轮对话耗时基准：进程内起 server（PGlite + 种子岗位 + 真实模型），按 SSE 客户端视角计时。
// 用法：NODE_USE_ENV_PROXY=1 node --env-file=<.env> packages/server/eval/latency.ts [--reps 2] [--out 文件]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDb, migrate, schema } from "@talksume/db";
import { createGateway, type LlmCallLog, loadGatewayConfig } from "@talksume/llm-gateway";
import { createEmbedderFromEnv, embedPendingJobs, seedJobsIfEmpty } from "@talksume/matching";
import {
  buildApp,
  devHeaderIdentity,
  gatewayLlm,
  gatewaySummarizer,
  gatewayTitler,
  type TurnReport,
} from "../src/index.ts";

const { values } = parseArgs({
  options: {
    reps: { type: "string", default: "2" },
    out: { type: "string", default: "latency.json" },
    only: { type: "string" },
    /** 两轮之间停顿的毫秒数，模拟用户看回复、打字的时间。 */
    think: { type: "string", default: "3000" },
  },
});

interface Script {
  name: string;
  turns: { kind: string; text: string }[];
}

const SCRIPTS: Script[] = [
  {
    name: "intake-then-jobs",
    turns: [
      { kind: "建档", text: "你好，我叫李明，江城大学计算机科学与技术本科，2026年6月毕业。" },
      { kind: "建档", text: "想找后端开发的实习，最好在上海。" },
      { kind: "建档", text: "邮箱是 liming@example.com" },
      { kind: "建档", text: "会 Java、Spring Boot 和 MySQL，Redis 也用过一些。" },
      { kind: "建档", text: "做过一个校园二手交易小程序的后端，我负责订单和搜索模块。" },
      { kind: "建档", text: "用的 Spring Boot、MySQL 和 Redis。" },
      { kind: "建档", text: "难点是高峰期搜索很慢，我加了 Redis 缓存，又改成了分页查询。" },
      { kind: "建档", text: "没有具体数字，记不清了。" },
      { kind: "问岗位", text: "帮我推荐几个适合我的岗位吧" },
      { kind: "问岗位", text: "上海有哪些后端开发实习？" },
      { kind: "解读", text: "第一个岗位我匹配度怎么样？差在哪？" },
      { kind: "定制", text: "按这个岗位帮我定制一下简历" },
    ],
  },
  {
    name: "many-facts",
    turns: [
      {
        kind: "多事实",
        text: "我是李明，江城大学软件工程硕士，2024年9月入学，2027年6月毕业。之前在星河科技做过三个月后端实习，用 Go 写订单服务，把接口延迟从 200ms 降到 80ms。会 Go、Java、MySQL 和 Kafka，拿过校一等奖学金。想找上海的后端校招。",
      },
      { kind: "建档", text: "本科也是江城大学，计算机专业，2020年到2024年。" },
      { kind: "建档", text: "实习是2025年7月到9月。" },
    ],
  },
];

const config = loadGatewayConfig();
const llmLogs: (LlmCallLog & { endedAt: number })[] = [];
const gateway = createGateway(config, {
  onLog: (log) => llmLogs.push({ ...log, endedAt: Date.now() }),
});

const handle = await createDb({ pglite: "memory://" });
await migrate(handle);
if (!process.env.SEED_JOBS_PATH) {
  console.error("用法: SEED_JOBS_PATH=<岗位.jsonl> node eval/latency.ts（岗位文件可用 jobs-ingest 抓取）");
  process.exit(2);
}
await seedJobsIfEmpty(handle.db);
const embedder = createEmbedderFromEnv();
if (embedder) await embedPendingJobs(handle.db, embedder);

const turnReports: TurnReport[] = [];
const app = buildApp({
  edition: "cloud",
  version: "bench",
  db: handle.db,
  identity: devHeaderIdentity(handle.db),
  llm: gatewayLlm(gateway),
  titler: gatewayTitler(gateway),
  summarizer: gatewaySummarizer(gateway),
  matching: { llm: gateway },
  resumeLlm: gateway,
  onTurnMetrics: (m) => turnReports.push(m),
});
const address = await app.listen({ host: "127.0.0.1", port: 0 });

async function api(path: string, init: RequestInit = {}) {
  return fetch(`${address}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-talksume-user": userId, ...init.headers },
  });
}

interface TurnRow {
  script: string;
  rep: number;
  index: number;
  kind: string;
  firstEventMs?: number | undefined;
  firstTokenMs?: number | undefined;
  /** 首个非空白正文或追问、岗位卡片，用户真正看到回复的时刻。 */
  firstContentMs?: number | undefined;
  doneMs: number;
  error?: string;
  reply: string;
  server?: TurnReport;
  llm: LlmCallLog[];
}

async function sendTurn(conversationId: string, text: string) {
  const t0 = performance.now();
  const res = await api(`/api/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: text }),
  });
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`no body ${res.status}`);
  const dec = new TextDecoder();
  let buf = "";
  let firstEventMs: number | undefined;
  let firstTokenMs: number | undefined;
  let firstContentMs: number | undefined;
  let error: string | undefined;
  let reply = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (let at = buf.indexOf("\n\n"); at >= 0; at = buf.indexOf("\n\n")) {
      const chunk = buf.slice(0, at);
      buf = buf.slice(at + 2);
      const event = /^event: (.+)$/m.exec(chunk)?.[1];
      if (!event) continue;
      const ms = Math.round(performance.now() - t0);
      if (event !== "done") firstEventMs ??= ms;
      if (
        event === "token" &&
        /\S/.test((JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] ?? "{}") as { text: string }).text)
      ) {
        firstTokenMs ??= ms;
      }
      if (event === "ask" || event === "jobs" || event === "about_job") firstContentMs ??= ms;
      const data = /^data: (.+)$/m.exec(chunk)?.[1] ?? "{}";
      if (event === "error") error = data.slice(0, 200);
      if (event === "token") reply += (JSON.parse(data) as { text: string }).text;
      if (event === "ask")
        reply += `\n[ask:${(JSON.parse(data) as { kind: string; question: string }).kind}] ${(JSON.parse(data) as { question: string }).question}`;
    }
  }
  if (firstTokenMs !== undefined) firstContentMs = Math.min(firstContentMs ?? firstTokenMs, firstTokenMs);
  return {
    firstEventMs,
    firstTokenMs,
    firstContentMs,
    doneMs: Math.round(performance.now() - t0),
    reply,
    ...(error && { error }),
  };
}

let userId = "";
const rows: TurnRow[] = [];
const reps = Number(values.reps);
for (let rep = 0; rep < reps; rep++) {
  for (const script of SCRIPTS.filter((s) => !values.only || s.name === values.only)) {
    const [user] = await handle.db
      .insert(schema.users)
      .values({ email: `bench-${rep}-${script.name}@example.com`, displayName: "李明" })
      .returning();
    userId = user?.id ?? "";
    const created = (await (await api("/api/v1/conversations", { method: "POST", body: "{}" })).json()) as {
      id: string;
    };
    for (const [index, turn] of script.turns.entries()) {
      if (index > 0) await new Promise((r) => setTimeout(r, Number(values.think)));
      const before = llmLogs.length;
      const reportsBefore = turnReports.length;
      const r = await sendTurn(created.id, turn.text);
      const row: TurnRow = {
        script: script.name,
        rep,
        index,
        kind: turn.kind,
        ...r,
        ...(turnReports[reportsBefore] && { server: turnReports[reportsBefore] }),
        llm: llmLogs.slice(before),
      };
      rows.push(row);
      const calls = row.server?.modelCalls.length ?? 0;
      console.log(
        `${script.name}#${rep}.${index} ${turn.kind} ttft=${r.firstTokenMs ?? "-"} content=${r.firstContentMs ?? "-"} first=${r.firstEventMs ?? "-"} done=${r.doneMs} calls=${calls} attempts=${row.llm.length}${r.error ? ` ERR ${r.error}` : ""}`,
      );
    }
  }
}

await app.close();
await handle.close();
const out = resolve(values.out as string);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ model: config.model, rows, llmLogs }, null, 1));
console.log(`写入 ${out}`);
