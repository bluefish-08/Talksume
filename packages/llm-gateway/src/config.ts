export const DEFAULT_MODEL = "deepseek-v4.1-flash";
export const DEFAULT_FALLBACK_MODEL = "glm-5.3";

export interface GatewayConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModel: string;
  /** 单次请求（含流式读取）的总超时。 */
  timeoutMs: number;
  /** 每个模型在首次请求之外的最大重试次数。 */
  maxRetries: number;
  retryBaseDelayMs: number;
  redactPii: boolean;
}

export class GatewayConfigError extends Error {}

export function loadGatewayConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<GatewayConfig> = {},
): GatewayConfig {
  const baseUrl = env.LLM_BASE_URL;
  const apiKey = env.LLM_API_KEY;
  if (!baseUrl) throw new GatewayConfigError("缺少环境变量 LLM_BASE_URL");
  if (!apiKey) throw new GatewayConfigError("缺少环境变量 LLM_API_KEY");
  return {
    baseUrl,
    apiKey,
    model: env.LLM_MODEL || DEFAULT_MODEL,
    fallbackModel: env.LLM_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,
    timeoutMs: 60_000,
    maxRetries: 3,
    retryBaseDelayMs: 500,
    redactPii: true,
    ...overrides,
  };
}
