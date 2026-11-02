import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createGateway,
  GatewayConfigError,
  type LlmCallLog,
  LlmUnrecoverableError,
  loadGatewayConfig,
} from "@talksume/llm-gateway";
import { createIntakeController } from "../src/index.ts";
import { loadDataset } from "./dataset.ts";
import { renderReport } from "./report.ts";
import { EvalAbortError, runSample, type SampleRun } from "./runner.ts";

const here = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    data: { type: "string", default: resolve(here, "samples.jsonl") },
    out: { type: "string", default: resolve(here, "out/report.md") },
    sample: { type: "string" },
    check: { type: "boolean", default: false },
  },
});

const samples = loadDataset(values.data as string).filter((s) => !values.sample || s.id === values.sample);
if (samples.length === 0) {
  console.error(`没有可运行的样例（--sample=${values.sample ?? ""}）`);
  process.exit(1);
}
if (values.check) {
  console.log(
    `数据集格式正确：${samples.length} 段对话，${samples.reduce((n, s) => n + s.turns.length, 0)} 轮发言`,
  );
  process.exit(0);
}

let config: ReturnType<typeof loadGatewayConfig>;
try {
  config = loadGatewayConfig();
} catch (error) {
  if (error instanceof GatewayConfigError) {
    console.error(
      `${error.message}。请用 node --env-file=<.env 路径> 运行，或在环境中设置 LLM_BASE_URL / LLM_API_KEY。`,
    );
    process.exit(1);
  }
  throw error;
}

const logs: LlmCallLog[] = [];
const gateway = createGateway(config, { onLog: (log) => logs.push(log) });
const controller = createIntakeController({
  streamFn: gateway.streamFn("eval.intake"),
  model: gateway.primaryModel,
});

const startedAt = new Date();
const runs: SampleRun[] = [];
try {
  for (const sample of samples) {
    console.log(`运行 ${sample.id}（${sample.turns.length} 轮）...`);
    const run = await runSample(sample, controller);
    runs.push(run);
    console.log(`  F1 ${(run.metrics.f1 * 100).toFixed(1)}%  完整度 ${(run.completeness * 100).toFixed(0)}%`);
  }
} catch (error) {
  const unrecoverable =
    error instanceof EvalAbortError
      ? error.code
      : error instanceof LlmUnrecoverableError
        ? error.kind
        : undefined;
  if (unrecoverable === "quota_exhausted") {
    console.error(
      "模型额度已用尽（429，API key token budget exceeded），评测无法继续。请充值或更换 LLM_API_KEY 后重试；未生成报告。",
    );
    process.exit(0);
  }
  if (unrecoverable === "auth") {
    console.error("模型鉴权失败，请检查 LLM_API_KEY 与 LLM_BASE_URL；未生成报告。");
    process.exit(0);
  }
  throw error;
}

const report = renderReport(runs, {
  model: config.model,
  fallbackModel: config.fallbackModel,
  dataset: values.data as string,
  startedAt,
  llmCalls: logs.length,
  llmFailures: logs.filter((l) => !l.success).length,
  totalTokens: logs.reduce((n, l) => n + l.totalTokens, 0),
});
const out = resolve(values.out as string);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, report);
console.log(`报告已写入 ${out}`);
