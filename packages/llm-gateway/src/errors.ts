export type LlmErrorKind =
  | "quota_exhausted"
  | "auth"
  | "invalid_request"
  | "rate_limited"
  | "server"
  | "timeout"
  | "network"
  | "invalid_output"
  | "aborted"
  | "unknown";

export class LlmGatewayError extends Error {
  kind: LlmErrorKind;
  model: string | undefined;

  constructor(kind: LlmErrorKind, message: string, model?: string) {
    super(message);
    this.name = new.target.name;
    this.kind = kind;
    this.model = model;
  }
}

/** 不可恢复错误：重试和切备用模型都没有意义。 */
export class LlmUnrecoverableError extends LlmGatewayError {}
export class LlmQuotaExceededError extends LlmUnrecoverableError {}
export class LlmAuthError extends LlmUnrecoverableError {}

const QUOTA =
  /insufficient[_ ]?quota|budget[_ ]?exceeded|quota[_ ]?exceeded|out of budget|billing|insufficient[_ ]?(?:balance|funds)|arrearage/i;
const AUTH =
  /invalid[_ ]?api[_ ]?key|incorrect api key|unauthori[sz]ed|authentication|(?<![a-z0-9])(?:401|403)(?![a-z0-9])/i;
const RATE = /rate.?limit|too many requests|overloaded|(?<![a-z0-9])429(?![a-z0-9])/i;
const SERVER =
  /(?<![a-z0-9])(?:500|502|503|504|520|524)(?![a-z0-9])|server.?error|internal.?error|service.?(?:is.?)?(?:temporarily.?)?unavailable|bad gateway|upstream/i;
const NETWORK = /network|connection|socket|econn|enotfound|fetch failed|stream was interrupted|terminated/i;
const INVALID =
  /(?<![a-z0-9])(?:400|404|413|422)(?![a-z0-9])|invalid[_ ]?request|context.?length|unsupported/i;

export function classifyErrorMessage(message: string): LlmErrorKind {
  if (QUOTA.test(message)) return "quota_exhausted";
  if (AUTH.test(message)) return "auth";
  if (RATE.test(message)) return "rate_limited";
  if (SERVER.test(message)) return "server";
  if (/time.?d?.?out|etimedout/i.test(message)) return "timeout";
  if (NETWORK.test(message)) return "network";
  if (INVALID.test(message)) return "invalid_request";
  return "unknown";
}

export function isRetryableKind(kind: LlmErrorKind): boolean {
  return kind === "rate_limited" || kind === "server" || kind === "timeout" || kind === "network";
}

export function isUnrecoverableKind(kind: LlmErrorKind): boolean {
  return kind === "quota_exhausted" || kind === "auth";
}

const TAG = /^\[llm:([a-z_]+)\] /;

/** 流式接口里错误只能编码在 errorMessage 中，用前缀标签携带错误类型。 */
export function tagErrorMessage(kind: LlmErrorKind, message: string): string {
  return `[llm:${kind}] ${message.replace(TAG, "")}`;
}

export function errorKindOf(errorMessage: string | undefined): LlmErrorKind | undefined {
  const match = errorMessage?.match(TAG);
  return match ? (match[1] as LlmErrorKind) : undefined;
}

export function toGatewayError(errorMessage: string, model?: string): LlmGatewayError {
  const kind = errorKindOf(errorMessage) ?? classifyErrorMessage(errorMessage);
  const text = errorMessage.replace(TAG, "");
  if (kind === "quota_exhausted") return new LlmQuotaExceededError(kind, text, model);
  if (kind === "auth") return new LlmAuthError(kind, text, model);
  return new LlmGatewayError(kind, text, model);
}
