import type { Job } from "@talksume/core";
import { classifyRole, type Role } from "./role.ts";

export interface SeedOptions {
  size?: number;
  quotas?: Record<Role, number>;
  minJdLength?: number;
}

const DEFAULT_QUOTAS: Record<Role, number> = { tech: 70, product: 40, design: 30, ops: 40, other: 20 };
const TYPE_PRIORITY: Record<string, number> = { internship: 0, campus: 1, experienced: 2 };

/** 在每个岗位类别内按"公司、招聘类型"轮转选取，优先实习与校招；配额不足时由其余类别补齐。 */
export function selectSeed(jobs: Job[], opts: SeedOptions = {}): Job[] {
  const size = opts.size ?? 200;
  const quotas = opts.quotas ?? DEFAULT_QUOTAS;
  const minJd = opts.minJdLength ?? 80;
  const pool = jobs.filter((j) => j.jdText.length >= minJd && j.cities.length > 0 && j.jobType);

  const byRole = new Map<Role, Job[]>();
  for (const j of pool) {
    const r = classifyRole(j);
    byRole.set(r, [...(byRole.get(r) ?? []), j]);
  }

  const queues = new Map<Role, Job[]>();
  for (const [role, list] of byRole) queues.set(role, interleaveByCompany(list));

  const picked: Job[] = [];
  const taken = new Set<string>();
  const take = (role: Role, n: number) => {
    const q = queues.get(role) ?? [];
    while (n > 0 && q.length > 0) {
      const j = q.shift() as Job;
      if (taken.has(j.id)) continue;
      taken.add(j.id);
      picked.push(j);
      n--;
    }
  };
  for (const role of Object.keys(quotas) as Role[]) take(role, quotas[role]);
  // 剩余名额按各类别剩余量轮流补
  while (picked.length < size && [...queues.values()].some((q) => q.length > 0)) {
    for (const role of queues.keys()) {
      if (picked.length >= size) break;
      take(role, 1);
    }
  }
  return picked.slice(0, size);
}

function interleaveByCompany(list: Job[]): Job[] {
  const sorted = [...list].sort(
    (a, b) => (TYPE_PRIORITY[a.jobType ?? ""] ?? 3) - (TYPE_PRIORITY[b.jobType ?? ""] ?? 3),
  );
  const buckets = new Map<string, Job[]>();
  for (const j of sorted) {
    const key = `${j.company}|${j.jobType}`;
    buckets.set(key, [...(buckets.get(key) ?? []), j]);
  }
  const out: Job[] = [];
  const lists = [...buckets.values()].map((items) => ({ items, next: 0 }));
  // 社招桶每 3 轮才出一条，保证实习与校招占多数
  for (let round = 0; lists.some((l) => l.next < l.items.length); round++) {
    for (const l of lists) {
      const j = l.items[l.next];
      if (!j || (j.jobType === "experienced" && round % 3 !== 0)) continue;
      out.push(j);
      l.next++;
    }
  }
  return out;
}
