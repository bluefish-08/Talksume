import { createHash } from "node:crypto";
import { type Db, schema } from "@talksume/db";
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { USER_IMPORT_SOURCE } from "./jobs-db.ts";

export const PROTECTED_SOURCES = new Set(["hr_workspace", USER_IMPORT_SOURCE]);

export interface DedupeRow {
  id: string;
  company: string;
  title: string;
  jobType: string | null;
  jdText: string;
  cities: string[];
  postedAt: Date | null;
}

const squash = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/** 同公司、同标题、同类型、同 JD 视为一次重复发布；类型缺失的不参与合并。「（实习）」等后缀不去掉，宁可漏并。 */
export function dedupeKey(
  row: Pick<DedupeRow, "company" | "title" | "jobType" | "jdText">,
): string | undefined {
  if (!row.jobType) return undefined;
  const jd = createHash("md5").update(squash(row.jdText)).digest("hex");
  return [row.company.trim(), squash(row.title), row.jobType, jd].join("\u0000");
}

export interface DedupeGroup {
  canonical: string;
  duplicates: string[];
  cities: string[];
}

/** 规范岗位：被投递引用过的优先，其次发布时间最新，再次 id 最小；城市取组内并集，规范岗位自己的排在前面。 */
export function planDedupe(rows: DedupeRow[], applied: ReadonlySet<string>): DedupeGroup[] {
  const byKey = new Map<string, DedupeRow[]>();
  for (const row of rows) {
    const key = dedupeKey(row);
    if (!key) continue;
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  const groups: DedupeGroup[] = [];
  for (const members of byKey.values()) {
    if (members.length < 2) continue;
    members.sort(
      (a, b) =>
        Number(applied.has(b.id)) - Number(applied.has(a.id)) ||
        (b.postedAt?.getTime() ?? -Infinity) - (a.postedAt?.getTime() ?? -Infinity) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const [head, ...rest] = members as [DedupeRow, ...DedupeRow[]];
    groups.push({
      canonical: head.id,
      duplicates: rest.map((r) => r.id),
      cities: [...new Set(members.flatMap((m) => m.cities))],
    });
  }
  return groups.sort((a, b) => (a.canonical < b.canonical ? -1 : 1));
}

export interface DedupeResult {
  groups: number;
  duplicates: number;
  changed: number;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 在招的抓取岗位按判重键分组并维护 duplicate_of 与规范岗位的城市并集；只写有变化的行，可重复执行。 */
export async function dedupeJobs(db: Db): Promise<DedupeResult> {
  const t = schema.jobs;
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: t.id,
        company: t.company,
        title: t.title,
        jobType: t.jobType,
        jdText: t.jdText,
        cities: t.cities,
        postedAt: t.postedAt,
        duplicateOf: t.duplicateOf,
      })
      .from(t)
      .where(and(eq(t.status, "open"), notInArray(t.source, [...PROTECTED_SOURCES])));
    const applied = await tx.selectDistinct({ id: schema.applications.jobId }).from(schema.applications);
    const groups = planDedupe(rows, new Set(applied.map((a) => a.id)));

    const target = new Map<string, string>();
    for (const g of groups) for (const id of g.duplicates) target.set(id, g.canonical);
    const byId = new Map(rows.map((r) => [r.id, r]));
    let changed = 0;

    const linked = await tx.select({ id: t.id }).from(t).where(isNotNull(t.duplicateOf));
    const stale = linked.map((r) => r.id).filter((id) => !target.has(id));
    if (stale.length > 0) {
      await tx.update(t).set({ duplicateOf: null }).where(inArray(t.id, stale));
      changed += stale.length;
    }
    for (const g of groups) {
      const head = byId.get(g.canonical);
      if (head && !sameList(head.cities, g.cities)) {
        await tx.update(t).set({ cities: g.cities }).where(eq(t.id, g.canonical));
        changed++;
      }
      const moved = g.duplicates.filter((id) => byId.get(id)?.duplicateOf !== g.canonical);
      if (moved.length > 0) {
        await tx.update(t).set({ duplicateOf: g.canonical }).where(inArray(t.id, moved));
        changed += moved.length;
      }
    }
    return {
      groups: groups.length,
      duplicates: target.size,
      changed,
    };
  });
}
