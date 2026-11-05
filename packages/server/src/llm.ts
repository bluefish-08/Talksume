import type { Gateway } from "@talksume/llm-gateway";
import type { LlmDeps, LlmModelOption } from "./app.ts";

const KNOWN: Record<string, Omit<LlmModelOption, "id">> = {
  "deepseek-v4.1-flash": { label: "DeepSeek V4.1 Flash", hint: "默认模型，回复快" },
  "glm-5.3": { label: "GLM-5.3", hint: "备用模型，可换个风格试试" },
};

const optionOf = (id: string): LlmModelOption => ({ id, ...(KNOWN[id] ?? { label: id, hint: "" }) });

/** 主模型排第一作为默认；所选模型失败时网关仍会切到另一个兜底。 */
export function gatewayLlm(gateway: Gateway, purpose = "intake"): LlmDeps {
  const { primaryModel, fallbackModel } = gateway;
  const ids = [...new Set([primaryModel.id, fallbackModel.id])];
  return {
    models: ids.map(optionOf),
    resolve: ({ model, thinking }) => ({
      // 用户在等：主模型重试一次还不行就换备用，不在一个卡住的上游上耗满重试
      streamFn: gateway.streamFn(purpose, { thinking, maxRetries: 1 }),
      model: model === fallbackModel.id ? fallbackModel : primaryModel,
    }),
  };
}
