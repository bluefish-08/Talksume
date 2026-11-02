import {
  DIM_KEYS,
  type DimKey,
  type JobSummary,
  type MatchItem,
  type MatchReport,
  type RefreshResult,
} from "./types.ts";

const SOURCE_LABELS: Record<string, string> = {
  tencent_campus: "腾讯招聘官网",
  mihoyo: "米哈游招聘官网",
  meituan: "美团招聘官网",
  netease: "网易招聘官网",
  user_import: "你粘贴的 JD",
  hr_workspace: "企业直投",
};

const JOB_TYPE_LABELS = { internship: "实习", campus: "校招", experienced: "社招" } as const;

const DEGREE_LABELS = {
  any: "学历不限",
  associate: "专科及以上",
  bachelor: "本科及以上",
  master: "硕士及以上",
  phd: "博士",
} as const;

export const DIM_LABELS: Record<DimKey, string> = {
  skills: "技能",
  role: "岗位意向",
  experience: "经历相关",
  major: "专业",
  city: "城市",
};

/** 只有排名靠前的岗位会生成 AI 报告，轮询也只关心这部分。 */
export const REPORT_TOP_N = 10;

export const sourceLabel = (source: string) => SOURCE_LABELS[source] ?? source;
export const jobTypeLabel = (t: JobSummary["jobType"]) => (t ? JOB_TYPE_LABELS[t] : undefined);
export const degreeLabel = (d: JobSummary["degree"]) => (d ? DEGREE_LABELS[d] : undefined);

export function citiesText(cities: string[], max = 2): string | undefined {
  if (cities.length === 0) return undefined;
  const shown = cities.slice(0, max).join(" / ");
  return cities.length > max ? `${shown} 等 ${cities.length} 城` : shown;
}

export function formatSalary(job: Pick<JobSummary, "salaryMin" | "salaryMax">): string | undefined {
  const k = (n: number) => `${Math.round(n / 100) / 10}`.replace(/\.0$/, "");
  const { salaryMin: lo, salaryMax: hi } = job;
  if (lo && hi) return `${k(lo)}-${k(hi)}K/月`;
  const one = lo ?? hi;
  return one ? `${k(one)}K/月` : undefined;
}

export function jobMeta(job: JobSummary, cityMax = 2): string {
  return [job.company, citiesText(job.cities, cityMax), jobTypeLabel(job.jobType), degreeLabel(job.degree)]
    .filter(Boolean)
    .join(" · ");
}

export const hasReport = (r: MatchReport) => Boolean(r.summary || r.strengths?.length || r.gaps?.length);

export function reportsPending(items: MatchItem[]): boolean {
  return items.slice(0, REPORT_TOP_N).some((m) => m.reportStatus === "pending");
}

export interface DimRow {
  key: DimKey;
  label: string;
  score: number;
  applicable: boolean;
}

export function dimRows(match: MatchItem): DimRow[] {
  return DIM_KEYS.map((key) => {
    const d = match.dims[key];
    return { key, label: DIM_LABELS[key], score: d?.score ?? 0, applicable: Boolean(d && d.weight > 0) };
  });
}

/** 没有 AI 报告时，用得分较高的维度证据充当“为什么推荐”；技能/经历/意向优先，专业和城市只在前者不足两条时补充。 */
export function evidenceLines(match: MatchItem, max = 4): string[] {
  const main: { text: string; weighted: number }[] = [];
  const context: string[] = [];
  for (const key of DIM_KEYS) {
    const d = match.dims[key];
    const text = d?.evidence[0];
    if (!d || !text || d.weight <= 0 || d.score < 0.6) continue;
    if (key === "major" || key === "city") context.push(text);
    else main.push({ text, weighted: d.score * d.weight });
  }
  const lines = main.sort((a, b) => b.weighted - a.weighted).map((x) => x.text);
  return (lines.length >= 2 ? lines : [...lines, ...context]).slice(0, max);
}

export function reasonLine(match: MatchItem): string | undefined {
  return match.report.strengths?.[0] ?? match.report.summary ?? evidenceLines(match, 1)[0];
}

export interface FilterChip {
  key: string;
  label: string;
  count: number;
}

const bachelorOk = (d: JobSummary["degree"]) =>
  d === undefined || d === "any" || d === "associate" || d === "bachelor";

export function buildChips(items: MatchItem[], maxCities = 4): FilterChip[] {
  const chips: FilterChip[] = [{ key: "all", label: "全部", count: items.length }];

  const cityCount = new Map<string, number>();
  for (const m of items) for (const c of new Set(m.job.cities)) cityCount.set(c, (cityCount.get(c) ?? 0) + 1);
  const topCities = [...cityCount].sort((a, b) => b[1] - a[1]).slice(0, maxCities);
  for (const [city, count] of topCities) chips.push({ key: `city:${city}`, label: city, count });

  for (const t of ["internship", "campus", "experienced"] as const) {
    const count = items.filter((m) => m.job.jobType === t).length;
    if (count > 0 && count < items.length) chips.push({ key: `type:${t}`, label: JOB_TYPE_LABELS[t], count });
  }

  const ok = items.filter((m) => bachelorOk(m.job.degree)).length;
  if (ok > 0 && ok < items.length) chips.push({ key: "degree:bachelor", label: "本科可投", count: ok });
  return chips;
}

export function applyFilter(items: MatchItem[], key: string): MatchItem[] {
  const [kind, value] = key.split(":");
  if (kind === "city") return items.filter((m) => m.job.cities.includes(value ?? ""));
  if (kind === "type") return items.filter((m) => m.job.jobType === value);
  if (kind === "degree") return items.filter((m) => bachelorOk(m.job.degree));
  return items;
}

/** 参与匹配的在招岗位总数：通过硬过滤的 + 被意向过滤掉的（已下架的不算）。 */
export function totalOpenJobs(r: RefreshResult): number {
  return r.candidates + r.excluded.jobType + r.excluded.city + r.excluded.degree;
}

export const EXCLUDED_NOTICE = {
  jobType: "岗位类型和你的求职意向不一致",
  city: "岗位城市不在你的意向城市内",
  degree: "岗位学历要求高于你的学历",
} as const;
