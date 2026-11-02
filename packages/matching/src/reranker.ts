import type { Job, Profile } from "@talksume/core";
import type { ScoredJob } from "./types.ts";

export interface Reranker {
  /** 返回与 documents 一一对应的相关度，0–1。 */
  rerank(query: string, documents: string[], signal?: AbortSignal): Promise<number[]>;
}

export interface HttpRerankerConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** 单个批次的时限。 */
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  batchSize?: number;
  fetch?: typeof fetch;
}

class RerankRequestError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 兼容 Xinference / Jina 风格 /rerank 的客户端，如 Qwen3-Reranker。 */
export class HttpReranker implements Reranker {
  readonly #config: HttpRerankerConfig;

  constructor(config: HttpRerankerConfig) {
    this.#config = config;
  }

  async rerank(query: string, documents: string[], signal?: AbortSignal): Promise<number[]> {
    // 服务端逐条串行计算，并发不会更快，按批顺序发送即可
    const size = Math.max(1, this.#config.batchSize ?? 50);
    const out: number[] = [];
    for (let i = 0; i < documents.length; i += size) {
      out.push(...(await this.#withRetry(query, documents.slice(i, i + size), signal)));
    }
    return out;
  }

  async #withRetry(query: string, documents: string[], signal?: AbortSignal): Promise<number[]> {
    const retries = Math.max(0, this.#config.retries ?? 1);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#batch(query, documents, signal);
      } catch (error) {
        const retryable = !(error instanceof RerankRequestError) || error.retryable;
        if (signal?.aborted || !retryable || attempt >= retries) throw error;
        await sleep(this.#config.retryDelayMs ?? 300);
      }
    }
  }

  async #batch(query: string, documents: string[], signal?: AbortSignal): Promise<number[]> {
    const { baseUrl, model, apiKey, timeoutMs = 10_000 } = this.#config;
    const doFetch = this.#config.fetch ?? fetch;
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await doFetch(`${baseUrl.replace(/\/+$/, "")}/rerank`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey && { authorization: `Bearer ${apiKey}` }) },
      body: JSON.stringify({ model, query, documents, top_n: documents.length }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 160);
      throw new RerankRequestError(
        `rerank 请求失败：HTTP ${res.status} ${detail}`.trim(),
        res.status === 429 || res.status >= 500,
      );
    }
    const body = (await res.json()) as { results?: { index?: number; relevance_score?: number }[] };
    const scores = new Array<number>(documents.length).fill(Number.NaN);
    for (const r of body.results ?? []) {
      if (Number.isInteger(r.index) && typeof r.relevance_score === "number") {
        scores[r.index as number] = r.relevance_score;
      }
    }
    if (scores.some((s) => !Number.isFinite(s))) {
      throw new RerankRequestError("rerank 返回结果与输入不一致", false);
    }
    return scores;
  }
}

/** 只有同时配置了 RERANK_BASE_URL 和 RERANK_MODEL 才启用；key 缺省时复用 EMBEDDING_API_KEY。 */
export function createRerankerFromEnv(
  env: Record<string, string | undefined> = process.env,
): Reranker | undefined {
  const baseUrl = env.RERANK_BASE_URL;
  const model = env.RERANK_MODEL;
  if (!baseUrl || !model) return undefined;
  const apiKey = env.RERANK_API_KEY || env.EMBEDDING_API_KEY;
  return new HttpReranker({ baseUrl, model, ...(apiKey && { apiKey }) });
}

// 服务端单条输入（query + 文档 + 模板）上限 512 token，中文约 0.6 token/字
export const QUERY_MAX_CHARS = 200;
export const DOC_MAX_CHARS = 300;

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** 问句前缀在标注集上让对口岗位的分数更高，无关岗位仍接近 0。 */
const QUERY_PREFIX = "这个岗位适合以下求职者吗？";

export function rerankQuery(profile: Profile): string {
  const list = (label: string, items: string[]) => (items.length > 0 ? `${label}：${items.join("、")}` : "");
  const major = profile.education.map((e) => e.major).filter((m): m is string => Boolean(m));
  const body = [
    list("求职意向", profile.intention.roles),
    list(
      "技能",
      profile.skills.slice(0, 15).map((s) => s.name),
    ),
    list(
      "经历",
      profile.experiences.slice(0, 3).map((e) => `${e.company}${e.title}`),
    ),
    list(
      "项目",
      profile.projects.slice(0, 3).map((p) => {
        const stack = p.techStack.slice(0, 4).join("/");
        return stack ? `${p.name}（${stack}）` : p.name;
      }),
    ),
    list("专业", [...new Set(major)].slice(0, 2)),
  ]
    .filter(Boolean)
    .join("；");
  return body ? `${QUERY_PREFIX}${body}`.slice(0, QUERY_MAX_CHARS) : "";
}

const REQUIREMENT_HEADING =
  /【?(任职要求|岗位要求|任职资格|职位要求|岗位资格|我们希望你|requirements|qualifications)】?[：:]?/i;
/** 职责最多占正文的四成，其余留给任职要求，避免长职责把技能要求挤掉。 */
const DUTY_SHARE = 0.4;

export function rerankDocument(job: Pick<Job, "title" | "company" | "jdText">): string {
  const head = `${job.title}｜${job.company}\n`;
  const jd = squash(job.jdText);
  const budget = DOC_MAX_CHARS - head.length;
  const at = jd.search(REQUIREMENT_HEADING);
  if (at <= 0 || jd.length <= budget) return `${head}${jd}`.slice(0, DOC_MAX_CHARS);
  const duties = jd.slice(0, at).trim();
  const dutyChars = Math.min(duties.length, Math.round(budget * DUTY_SHARE));
  return `${head}${duties.slice(0, dutyChars)} ${jd.slice(at)}`.slice(0, DOC_MAX_CHARS);
}

export const DEFAULT_SEMANTIC_TOP_K = 100;
// 线上库 4 个画像盲标：nDCG@20 在 0.3 最高，再大时前 20 回落，见 eval/README.md
export const DEFAULT_SEMANTIC_WEIGHT = 0.3;
export const DEFAULT_SEMANTIC_TIMEOUT_MS = 15_000;

function semanticEvidence(score: number): string {
  if (score >= 0.8) return "语义模型判断岗位内容与你的意向和经历高度相关";
  if (score >= 0.4) return "语义模型判断岗位内容与你的意向和经历部分相关";
  return "语义模型判断岗位内容与你的意向和经历关联不大";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 模型输出的是「是否相关」的概率，对口岗位常在 0.05–0.5，按数量级映射到 0–1：0.001 及以下为 0，0.01 约 0.33，0.1 约 0.67。 */
export const LOG_FLOOR = 1e-3;

export function calibrate(probability: number): number {
  if (!(probability > LOG_FLOOR)) return 0;
  return Math.min(1, Math.log10(probability / LOG_FLOOR) / -Math.log10(LOG_FLOOR));
}

/** 综合分 =（1 − w）× 规则分 + w × 语义相关度 × 100，再乘反馈系数。 */
export function blendSemantic(scored: ScoredJob, relevance: number, weight: number): ScoredJob {
  const s = Math.min(1, Math.max(0, relevance));
  const base = (1 - weight) * scored.baseScore + weight * s * 100;
  return {
    ...scored,
    baseScore: round1(base),
    score: round1(Math.min(100, Math.max(0, base * scored.feedbackMultiplier))),
    semantic: { score: s, weight, evidence: [semanticEvidence(s)] },
  };
}

export interface SemanticOptions {
  topK?: number;
  weight?: number;
  timeoutMs?: number;
}

export interface SemanticResult {
  matches: ScoredJob[];
  reranked: number;
  ms: number;
  error?: unknown;
}

const byScore = (a: ScoredJob, b: ScoredJob) => b.score - a.score || a.job.id.localeCompare(b.job.id);

/** 对排名前 topK 的岗位做语义重排并重新排序；失败或超时原样返回，由调用方记录原因。 */
export async function applySemantic(
  reranker: Reranker,
  profile: Profile,
  matches: ScoredJob[],
  opts: SemanticOptions = {},
): Promise<SemanticResult> {
  const head = matches.slice(0, opts.topK ?? DEFAULT_SEMANTIC_TOP_K);
  const query = rerankQuery(profile);
  if (head.length === 0 || !query) return { matches, reranked: 0, ms: 0 };
  const weight = opts.weight ?? DEFAULT_SEMANTIC_WEIGHT;
  const start = performance.now();
  try {
    const scores = await reranker.rerank(
      query,
      head.map((m) => rerankDocument(m.job)),
      AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_SEMANTIC_TIMEOUT_MS),
    );
    const blended = head.map((m, i) => blendSemantic(m, calibrate(scores[i] ?? 0), weight));
    return {
      matches: [...blended, ...matches.slice(head.length)].sort(byScore),
      reranked: head.length,
      ms: Math.round(performance.now() - start),
    };
  } catch (error) {
    return { matches, reranked: 0, ms: Math.round(performance.now() - start), error };
  }
}
