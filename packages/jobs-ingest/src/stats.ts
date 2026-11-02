import type { Job } from "@talksume/core";
import { classifyRole } from "./role.ts";

export interface Stats {
  total: number;
  withJd: number;
  withCity: number;
  withJobType: number;
  withUrl: number;
  byType: Record<string, number>;
  byRole: Record<string, number>;
  byCompany: Record<string, number>;
  topCities: [string, number][];
  /** 各字段缺失条数 */
  missing: Record<"jd" | "cities" | "jobType" | "degree" | "postedAt" | "url" | "tags", number>;
}

const JD_MIN = 50;

export function computeStats(jobs: Job[]): Stats {
  const count = (keys: string[]) => {
    const m: Record<string, number> = {};
    for (const k of keys) m[k] = (m[k] ?? 0) + 1;
    return m;
  };
  const cities = count(jobs.flatMap((j) => j.cities));
  return {
    total: jobs.length,
    withJd: jobs.filter((j) => j.jdText.length >= JD_MIN).length,
    withCity: jobs.filter((j) => j.cities.length > 0).length,
    withJobType: jobs.filter((j) => j.jobType).length,
    withUrl: jobs.filter((j) => j.url).length,
    byType: count(jobs.map((j) => j.jobType ?? "unknown")),
    byRole: count(jobs.map(classifyRole)),
    byCompany: count(jobs.map((j) => j.company)),
    topCities: Object.entries(cities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
    missing: {
      jd: jobs.filter((j) => j.jdText.length < JD_MIN).length,
      cities: jobs.filter((j) => j.cities.length === 0).length,
      jobType: jobs.filter((j) => !j.jobType).length,
      degree: jobs.filter((j) => !j.degree).length,
      postedAt: jobs.filter((j) => !j.postedAt).length,
      url: jobs.filter((j) => !j.url).length,
      tags: jobs.filter((j) => j.tags.length === 0).length,
    },
  };
}
