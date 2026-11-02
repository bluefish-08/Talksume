import type { Job } from "@talksume/core";
import type { HttpClient } from "./http.ts";

export type JobType = NonNullable<Job["jobType"]>;

export interface FetchContext {
  http: HttpClient;
  limit: number;
  /** 只采这些招聘类型；未指定则全部 */
  types?: JobType[] | undefined;
  now: () => Date;
  onError: (message: string) => void;
}

export interface SourceAdapter {
  name: string;
  company: string;
  fetch(ctx: FetchContext): AsyncGenerator<Job>;
}

/** 把"深圳总部 / 北京市 / 上海（临港）"等写法统一成中文城市名数组。 */
export function normalizeCities(raw: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : (raw ?? "").split(/[\s,，、/;；|]+/);
  const out: string[] = [];
  for (const p of parts) {
    let c = p.replace(/[（(].*?[）)]/g, "").trim();
    c = c.replace(/总部$/, "");
    if (c.length > 2 && c.endsWith("市")) c = c.slice(0, -1);
    if (!c || /^(远程面试|远程|全国|不限)$/.test(c)) continue;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

export function joinJd(sections: [label: string, text: string | null | undefined][]): string {
  return sections
    .filter(([, t]) => t?.trim())
    .map(([label, t]) => `【${label}】\n${(t as string).trim()}`)
    .join("\n\n");
}

export function parseDegree(text: string | null | undefined): Job["degree"] {
  if (!text) return undefined;
  if (/博士/.test(text)) return "phd";
  if (/硕士|研究生/.test(text)) return "master";
  if (/本科/.test(text)) return "bachelor";
  if (/大专|专科/.test(text)) return "associate";
  if (/不限/.test(text)) return "any";
  return undefined;
}

export function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\r\n?/g, "\n").trim();
}

/** 轮流从多个流各取一条，使有限条数下也能覆盖所有招聘类型。 */
export async function* roundRobin<T>(streams: AsyncGenerator<T>[]): AsyncGenerator<T> {
  const live = [...streams];
  while (live.length > 0) {
    for (const s of [...live]) {
      const r = await s.next();
      if (r.done) live.splice(live.indexOf(s), 1);
      else yield r.value;
    }
  }
}

export function wantType(ctx: FetchContext, t: JobType | undefined): boolean {
  return !ctx.types || (t !== undefined && ctx.types.includes(t));
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
}

/** 翻页拉取；单页失败（重试耗尽）只跳过该页，连续 3 页失败才放弃该流。 */
export async function* paginate<T>(
  ctx: FetchContext,
  label: string,
  getPage: (pageNo: number) => Promise<Page<T>>,
): AsyncGenerator<T> {
  let failures = 0;
  for (let n = 1; ; n++) {
    let page: Page<T>;
    try {
      page = await getPage(n);
      failures = 0;
    } catch (e) {
      ctx.onError(`${label} 第 ${n} 页失败: ${(e as Error).message}`);
      if (++failures >= 3) return;
      continue;
    }
    yield* page.items;
    if (!page.hasMore || page.items.length === 0) return;
  }
}
