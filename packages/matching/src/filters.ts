import type { Job, Profile } from "@talksume/core";
import type { Degree, FilterResult } from "./types.ts";

export const DEGREE_RANK: Record<Degree, number> = { any: 0, associate: 1, bachelor: 2, master: 3, phd: 4 };
export const DEGREE_LABEL: Record<Degree, string> = {
  any: "不限",
  associate: "专科",
  bachelor: "本科",
  master: "硕士",
  phd: "博士",
};

const DEGREE_WORDS: [Degree, RegExp][] = [
  ["phd", /博士/],
  ["master", /硕士|研究生/],
  ["bachelor", /本科/],
  ["associate", /大专|专科/],
];

const NO_CITY_LIMIT = /不限|全国|远程|remote|anywhere|任意/i;

export function highestDegree(profile: Profile): Degree | undefined {
  let best: Degree | undefined;
  for (const e of profile.education) if (!best || DEGREE_RANK[e.degree] > DEGREE_RANK[best]) best = e.degree;
  return best;
}

/** 岗位字段优先；字段缺失时从 JD 里「本科及以上」「硕士在读」一类的写法推断，多处出现取最低要求。 */
export function requiredDegree(
  job: Pick<Job, "degree" | "jdText">,
): { degree: Degree; source: string } | undefined {
  if (job.degree && job.degree !== "any") return { degree: job.degree, source: "岗位学历字段" };
  if (job.degree === "any") return undefined;
  let lowest: { degree: Degree; source: string } | undefined;
  const re =
    /(博士|硕士|研究生|本科|大专|专科)(?:研究生|学历|学位)?\s*(?:及|或)?\s*(以上|在读)(?!.{0,4}优先)/g;
  for (const m of job.jdText.matchAll(re)) {
    const word = m[1] ?? "";
    const entry = DEGREE_WORDS.find(([, w]) => w.test(word));
    if (!entry) continue;
    const [degree] = entry;
    if (!lowest || DEGREE_RANK[degree] < DEGREE_RANK[lowest.degree])
      lowest = { degree, source: `JD「${m[0]}」` };
  }
  return lowest;
}

export function wantsAnyCity(cities: string[]): boolean {
  return cities.some((c) => NO_CITY_LIMIT.test(c));
}

export function jobAllowsAnyCity(cities: string[]): boolean {
  return cities.some((c) => /远程|remote|全国|不限/i.test(c));
}

const stripSuffix = (city: string) => city.trim().replace(/市$/, "");

export function profileCities(profile: Profile): string[] {
  return profile.intention.cities.map(stripSuffix).filter(Boolean);
}

/** 返回意向城市列表里第一个与岗位城市重合的城市及其序号。 */
export function matchCity(
  preferred: string[],
  jobCities: string[],
): { city: string; rank: number } | undefined {
  const jobs = jobCities.map(stripSuffix);
  for (const [rank, city] of preferred.entries()) if (jobs.includes(city)) return { city, rank };
  return undefined;
}

export interface FilterOptions {
  strictCity?: boolean;
}

export function applyHardFilters(
  profile: Profile,
  job: Job,
  opts: FilterOptions & { status?: string } = {},
): FilterResult {
  if (opts.status === "closed") return { pass: false, reason: "closed", detail: "岗位已关闭" };

  const wantedType = profile.intention.jobType;
  if (wantedType && job.jobType && wantedType !== job.jobType) {
    return { pass: false, reason: "jobType", detail: `意向类型 ${wantedType}，岗位为 ${job.jobType}` };
  }

  const cities = profileCities(profile);
  if ((opts.strictCity ?? true) && cities.length > 0 && !wantsAnyCity(cities) && job.cities.length > 0) {
    if (!jobAllowsAnyCity(job.cities) && !matchCity(cities, job.cities)) {
      return {
        pass: false,
        reason: "city",
        detail: `意向城市 ${cities.join("/")}，岗位在 ${job.cities.join("/")}`,
      };
    }
  }

  const have = highestDegree(profile);
  const need = requiredDegree(job);
  if (have && need && DEGREE_RANK[have] < DEGREE_RANK[need.degree]) {
    return {
      pass: false,
      reason: "degree",
      detail: `最高学历${DEGREE_LABEL[have]}，${need.source}要求${DEGREE_LABEL[need.degree]}`,
    };
  }
  return { pass: true };
}

export const FILTER_HINTS = {
  jobType: "放宽求职类型（实习/校招/社招）",
  city: "增加意向城市或改为不限城市",
  degree: "补全学历信息，或关注学历要求更低的岗位",
  closed: "等待岗位重新开放",
} as const;
