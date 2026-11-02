import type { Job } from "@talksume/core";

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/** 按 source + sourceJobId 合并重复出现的岗位：城市与标签取并集，其余字段以较新抓取的为准、缺失时回填。 */
export function mergeJobs(jobs: Iterable<Job>): Job[] {
  const byKey = new Map<string, Job>();
  for (const job of jobs) {
    const key = `${job.source}\u0000${job.sourceJobId}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, job);
      continue;
    }
    const [older, newer] = prev.fetchedAt <= job.fetchedAt ? [prev, job] : [job, prev];
    byKey.set(key, {
      ...older,
      ...Object.fromEntries(Object.entries(newer).filter(([, v]) => v !== undefined)),
      id: prev.id,
      cities: union(prev.cities, job.cities),
      tags: union(prev.tags, job.tags),
      jdText: newer.jdText || older.jdText,
    } as Job);
  }
  return [...byKey.values()];
}
