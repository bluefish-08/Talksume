import { createGateway, type Gateway, type LlmCallLog, loadGatewayConfig } from "@talksume/llm-gateway";
import type { Target } from "./target.ts";

export interface UsageRow {
  calls: number;
  failed: number;
  fallback: number;
  inputTokens: number;
  outputTokens: number;
}

/** 按 purpose 累计调用次数和 token，评测结束时写进报告。 */
export class Usage {
  rows: Record<string, UsageRow> = {};

  add(log: Pick<LlmCallLog, "purpose" | "success" | "usedFallback" | "inputTokens" | "outputTokens">) {
    const row = this.rows[log.purpose] ?? {
      calls: 0,
      failed: 0,
      fallback: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    this.rows[log.purpose] = row;
    row.calls++;
    if (!log.success) row.failed++;
    if (log.usedFallback) row.fallback++;
    row.inputTokens += log.inputTokens;
    row.outputTokens += log.outputTokens;
  }

  total(): UsageRow {
    const out: UsageRow = { calls: 0, failed: 0, fallback: 0, inputTokens: 0, outputTokens: 0 };
    for (const r of Object.values(this.rows)) {
      out.calls += r.calls;
      out.failed += r.failed;
      out.fallback += r.fallback;
      out.inputTokens += r.inputTokens;
      out.outputTokens += r.outputTokens;
    }
    return out;
  }
}

export const MODEL = process.env.EVAL_MODEL || "deepseek-flash";

/** 备用模型钉成同一个，免得重试耗尽时悄悄换成 pro 混进结果。 */
export function agentGateway(target: Target, usage: Usage, model = MODEL) {
  const config = target.gateway.loadGatewayConfig(process.env, { model, fallbackModel: model });
  return target.gateway.createGateway(config, { onLog: (log) => usage.add(log) });
}

/** 模拟用户和判定器固定用当前 checkout 的网关，A/B 两边一致。 */
export function toolGateway(usage: Usage, model = MODEL): Gateway {
  const config = loadGatewayConfig(process.env, { model, fallbackModel: model });
  return createGateway(config, { onLog: (log) => usage.add(log) });
}
