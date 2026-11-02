import { EMBEDDING_DIMENSIONS } from "@talksume/db";

export interface Embedder {
  readonly dimensions: number;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export interface OpenAiEmbedderConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  dimensions?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const MAX_INPUT_CHARS = 6000;
const BATCH_SIZE = 32;

/** 兼容 OpenAI /embeddings 的客户端，如 Xinference 上的 bge-m3。 */
export class OpenAiEmbedder implements Embedder {
  readonly dimensions: number;
  readonly #config: OpenAiEmbedderConfig;

  constructor(config: OpenAiEmbedderConfig) {
    this.#config = config;
    this.dimensions = config.dimensions ?? EMBEDDING_DIMENSIONS;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      out.push(...(await this.#embedBatch(texts.slice(i, i + BATCH_SIZE), signal)));
    }
    return out;
  }

  async #embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const { baseUrl, model, apiKey, timeoutMs = 30_000 } = this.#config;
    const doFetch = this.#config.fetch ?? fetch;
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await doFetch(`${baseUrl.replace(/\/+$/, "")}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey && { authorization: `Bearer ${apiKey}` }) },
      body: JSON.stringify({ model, input: texts.map((t) => t.slice(0, MAX_INPUT_CHARS)) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) throw new Error(`embedding 请求失败：HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { index?: number; embedding?: number[] }[] };
    const rows = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== texts.length) throw new Error("embedding 返回条数与输入不一致");
    return rows.map((r) => {
      if (!r.embedding || r.embedding.length < this.dimensions) {
        throw new Error(`embedding 维度应为 ${this.dimensions}，实际 ${r.embedding?.length ?? 0}`);
      }
      return r.embedding.length === this.dimensions ? r.embedding : truncate(r.embedding, this.dimensions);
    });
  }
}

/** MRL 训练的模型（如 Qwen3-Embedding）前 n 维仍可用，截断后重新 L2 归一化；列宽和 HNSW 索引都限定了维度。 */
export function truncate(v: number[], n: number): number[] {
  const head = v.slice(0, n);
  const norm = Math.sqrt(head.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? head.map((x) => x / norm) : head;
}

/** 只有同时配置了 EMBEDDING_BASE_URL 和 EMBEDDING_MODEL 才启用向量召回。 */
export function createEmbedderFromEnv(
  env: Record<string, string | undefined> = process.env,
): Embedder | undefined {
  const baseUrl = env.EMBEDDING_BASE_URL;
  const model = env.EMBEDDING_MODEL;
  if (!baseUrl || !model) return undefined;
  const apiKey = env.EMBEDDING_API_KEY ?? env.LLM_API_KEY;
  return new OpenAiEmbedder({ baseUrl, model, ...(apiKey && { apiKey }) });
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}
