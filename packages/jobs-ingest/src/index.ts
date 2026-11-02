import type { Job } from "@talksume/core";
import { meituan } from "./adapters/meituan.ts";
import { mihoyo } from "./adapters/mihoyo.ts";
import { netease } from "./adapters/netease.ts";
import { tencentCampus } from "./adapters/tencent-campus.ts";
import { tencentSocial } from "./adapters/tencent-social.ts";
import type { JobType, SourceAdapter } from "./common.ts";
import { createHttpClient, type HttpClient } from "./http.ts";

export type { JobType, SourceAdapter } from "./common.ts";
export { createHttpClient, USER_AGENT } from "./http.ts";
export { mergeJobs } from "./merge.ts";

export const adapters: Record<string, SourceAdapter> = Object.fromEntries(
  [tencentCampus, tencentSocial, netease, meituan, mihoyo].map((a) => [a.name, a]),
);

export interface IngestOptions {
  source: string;
  limit: number;
  types?: JobType[];
  http?: HttpClient;
  now?: () => Date;
  onError?: (message: string) => void;
  skip?: (id: string) => boolean;
}

export async function* ingest(opts: IngestOptions): AsyncGenerator<Job> {
  const adapter = adapters[opts.source];
  if (!adapter) throw new Error(`未知数据源 ${opts.source}，可选: ${Object.keys(adapters).join(", ")}`);
  if (opts.limit <= 0) return;
  const seen = new Set<string>();
  for await (const job of adapter.fetch({
    http: opts.http ?? createHttpClient(),
    limit: opts.limit,
    types: opts.types,
    now: opts.now ?? (() => new Date()),
    onError: opts.onError ?? (() => {}),
    skip: opts.skip,
  })) {
    if (opts.skip?.(job.id)) continue;
    // 同一岗位重复出现时照样产出，由 mergeJobs 合并城市；限量只按不同岗位计数
    seen.add(job.id);
    yield job;
    if (seen.size >= opts.limit) return;
  }
}
