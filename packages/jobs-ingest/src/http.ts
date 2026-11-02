import { isAllowed, NO_RULES, parseRobots, type RobotsRules } from "./robots.ts";

export const USER_AGENT = "TalksumeBot/0.1 (student competition)";

export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export class RobotsBlockedError extends Error {
  constructor(url: string) {
    super(`robots.txt 禁止访问: ${url}`);
    this.name = "RobotsBlockedError";
  }
}

export interface HttpClientOptions {
  /** 同一域名两次请求的最小间隔，合规要求不低于 1000 */
  minIntervalMs?: number;
  retries?: number;
  backoffMs?: number;
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  checkRobots?: boolean;
}

export interface JsonRequest {
  method?: "GET" | "POST";
  json?: unknown;
  form?: Record<string, string>;
}

export interface HttpClient {
  json<T = unknown>(url: string, req?: JsonRequest): Promise<T>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createHttpClient(opts: HttpClientOptions = {}): HttpClient {
  const minInterval = Math.max(opts.minIntervalMs ?? 1000, 1000);
  const retries = opts.retries ?? 3;
  const backoff = opts.backoffMs ?? 2000;
  const timeout = opts.timeoutMs ?? 20_000;
  const ua = opts.userAgent ?? USER_AGENT;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const robotsOn = opts.checkRobots ?? true;

  const nextSlot = new Map<string, number>();
  const robotsCache = new Map<string, Promise<RobotsRules>>();

  // 同步预约时间槽，保证并发调用同一域名时也串行间隔
  async function throttle(host: string): Promise<void> {
    const at = Math.max(now(), nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + minInterval);
    const wait = at - now();
    if (wait > 0) await sleep(wait);
  }

  async function rawFetch(url: string, init: RequestInit): Promise<Response> {
    await throttle(new URL(url).host);
    return doFetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  }

  function loadRobots(origin: string): Promise<RobotsRules> {
    let p = robotsCache.get(origin);
    if (!p) {
      p = (async () => {
        try {
          const res = await rawFetch(`${origin}/robots.txt`, { headers: { "user-agent": ua } });
          const type = res.headers.get("content-type") ?? "";
          if (!res.ok || !type.includes("text/plain")) return NO_RULES;
          return parseRobots(await res.text(), ua);
        } catch {
          return NO_RULES;
        }
      })();
      robotsCache.set(origin, p);
    }
    return p;
  }

  return {
    async json<T>(url: string, req: JsonRequest = {}): Promise<T> {
      const u = new URL(url);
      if (robotsOn) {
        const rules = await loadRobots(u.origin);
        if (!isAllowed(rules, u.pathname)) throw new RobotsBlockedError(url);
      }
      const headers: Record<string, string> = { "user-agent": ua, accept: "application/json" };
      let body: string | undefined;
      if (req.json !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(req.json);
      } else if (req.form) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(req.form).toString();
      }
      const method = req.method ?? (body === undefined ? "GET" : "POST");
      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await sleep(backoff * 2 ** (attempt - 1));
        try {
          const init: RequestInit = { method, headers };
          if (body !== undefined) init.body = body;
          const res = await rawFetch(url, init);
          if (res.status === 429 || res.status >= 500)
            throw new HttpError(`HTTP ${res.status} ${url}`, res.status);
          if (!res.ok) {
            // 4xx 非限流：不重试，直接交给调用方跳过
            throw Object.assign(new HttpError(`HTTP ${res.status} ${url}`, res.status), { fatal: true });
          }
          return (await res.json()) as T;
        } catch (e) {
          lastErr = e;
          if ((e as { fatal?: boolean }).fatal) throw e;
        }
      }
      throw lastErr;
    },
  };
}
