export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

// 三组路由的错误体形状不一致：{code,message} / {error:code,message} / {error:{code,message}}
export function toApiError(status: number, body: unknown): ApiError {
  const b = (body ?? {}) as Record<string, unknown>;
  const nested =
    typeof b.error === "object" && b.error !== null ? (b.error as Record<string, unknown>) : undefined;
  const code = String(
    nested?.code ?? (typeof b.error === "string" ? b.error : undefined) ?? b.code ?? `http_${status}`,
  );
  const message = String(nested?.message ?? b.message ?? "请求失败，请稍后再试");
  return new ApiError(status, code, message, b.retryable === true || status >= 500);
}

let onUnauthorized: () => void = () => {};

/** 业务接口返回 401（会话过期、被踢下线）时，由登录态容器接手跳转登录页。 */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export function reportStatus(status: number, path: string): void {
  if (status === 401 && !path.startsWith("/api/v1/auth/")) onUnauthorized();
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  headers: Record<string, string> = {},
): Promise<T> {
  const init: RequestInit = { method, headers: { Accept: "application/json", ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, "Content-Type": "application/json" };
  }
  if (signal) init.signal = signal;
  const res = await fetch(path, init);
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    reportStatus(res.status, path);
    throw toApiError(res.status, data);
  }
  return data as T;
}

function client(headers: Record<string, string> = {}) {
  return {
    get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal, headers),
    post: <T>(path: string, body: unknown = {}, signal?: AbortSignal) =>
      request<T>("POST", path, body, signal, headers),
    patch: <T>(path: string, body: unknown, signal?: AbortSignal) =>
      request<T>("PATCH", path, body, signal, headers),
    delete: <T>(path: string, signal?: AbortSignal) => request<T>("DELETE", path, undefined, signal, headers),
  };
}

export const api = client();
