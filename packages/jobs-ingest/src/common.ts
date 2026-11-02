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
  /** 断点续抓：返回 true 的岗位 id 不再请求详情 */
  skip?: ((id: string) => boolean) | undefined;
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

const DEGREE_RANK = { associate: 0, bachelor: 1, master: 2, phd: 3 } as const;

/** 从 JD 里找「X及以上/在读」「X或Y」的最低学历门槛；"优先"不算门槛。 */
export function degreeFromJd(text: string | null | undefined): Job["degree"] {
  let lowest: keyof typeof DEGREE_RANK | undefined;
  const words = (s: string) =>
    [...s.matchAll(/博士|硕士|研究生|本科|大专|专科/g)].map((w) => parseDegree(w[0]));
  for (const m of (text ?? "").matchAll(
    /(博士|硕士|研究生|本科|大专|专科)(?:研究生|学历|学位)?\s*(?:及|或)?\s*(以上|在读)(?!.{0,4}优先)|(?:博士|硕士|研究生|本科)\s*[或/、]\s*(?:博士|硕士|研究生|本科)(?:学位|学历|学生|毕业生)?(?![^，。；\n]{0,6}优先)/g,
  )) {
    for (const d of words(m[0]) as (keyof typeof DEGREE_RANK)[]) {
      if (!lowest || DEGREE_RANK[d] < DEGREE_RANK[lowest]) lowest = d;
    }
  }
  return lowest;
}

/** 毫秒时间戳或「2026年11月02日」，按北京时间解析。 */
export function parseTime(v: number | string | null | undefined): Date | undefined {
  if (typeof v === "number") return v > 0 ? new Date(v) : undefined;
  const m = v?.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) return undefined;
  return new Date(`${m[1]}-${m[2]?.padStart(2, "0")}-${m[3]?.padStart(2, "0")}T00:00:00+08:00`);
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
