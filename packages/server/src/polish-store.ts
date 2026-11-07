import {
  type AcceptedPolish,
  applyPolish,
  isPolishNoop,
  type PolishTarget,
  polishTargets,
  type ResumeContent,
} from "@talksume/core";
import { type Db, schema } from "@talksume/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PolishOutcome } from "./polish-llm.ts";

const { resumePolishes } = schema;
type PolishRow = typeof resumePolishes.$inferSelect;

export type PolishAction = "accept" | "dismiss" | "revert";

export interface PolishEntry extends PolishTarget {
  /** 同一位置采用过润色，但原文后来变了且还没重新润色。 */
  stale: boolean;
  polish: {
    id: string;
    suggestion: string;
    accepted: string | null;
    status: PolishRow["status"];
    violations: string[];
  } | null;
}

export function loadPolishRows(db: Db, userId: string): Promise<PolishRow[]> {
  return db.select().from(resumePolishes).where(eq(resumePolishes.userId, userId));
}

export function acceptedOf(rows: readonly PolishRow[]): AcceptedPolish[] {
  return rows.flatMap((r) =>
    r.accepted ? [{ itemKey: r.itemKey, sourceHash: r.sourceHash, text: r.accepted }] : [],
  );
}

export async function polishedResume(db: Db, userId: string, resume: ResumeContent): Promise<ResumeContent> {
  return applyPolish(resume, acceptedOf(await loadPolishRows(db, userId)));
}

export function polishEntries(resume: ResumeContent, rows: readonly PolishRow[]): PolishEntry[] {
  const byKey = new Map(rows.map((r) => [`${r.itemKey}#${r.sourceHash}`, r]));
  return polishTargets(resume).map((target) => {
    const row = byKey.get(`${target.itemKey}#${target.sourceHash}`);
    const stale =
      !row &&
      rows.some(
        (r) =>
          r.itemKey === target.itemKey &&
          r.slot === target.slot &&
          r.sourceHash !== target.sourceHash &&
          !!r.accepted,
      );
    return {
      ...target,
      stale,
      polish: row
        ? {
            id: row.id,
            suggestion: row.suggestion,
            accepted: row.accepted,
            status: row.status,
            violations: row.violations,
          }
        : null,
    };
  });
}

/** 原样返回的「建议」不算改动；REST 和对话工具都先过这一步。 */
export function splitPolishOutcomes(outcomes: readonly PolishOutcome[]) {
  const changed: PolishOutcome[] = [];
  const noops: PolishOutcome[] = [];
  for (const outcome of outcomes)
    (isPolishNoop(outcome.target.text, outcome.text) ? noops : changed).push(outcome);
  return { changed, noops };
}

export async function savePolishOutcomes(db: Db, userId: string, outcomes: readonly PolishOutcome[]) {
  if (outcomes.length === 0) return;
  await db
    .insert(resumePolishes)
    .values(
      outcomes.map(({ target, text, violations, model }) => ({
        userId,
        itemKey: target.itemKey,
        slot: target.slot,
        sourceHash: target.sourceHash,
        sourceText: target.text,
        factIds: target.factIds,
        suggestion: text,
        violations,
        model,
      })),
    )
    .onConflictDoUpdate({
      target: [resumePolishes.userId, resumePolishes.itemKey, resumePolishes.sourceHash],
      set: {
        slot: sql`excluded.slot`,
        factIds: sql`excluded.fact_ids`,
        suggestion: sql`excluded.suggestion`,
        violations: sql`excluded.violations`,
        model: sql`excluded.model`,
        status: "pending",
        updatedAt: sql`now()`,
      },
    });
}

/** 有违规词的建议不能采用。accepted 列是当前生效的文字，status 只表示是否还有待审的建议。 */
export async function decidePolishes(db: Db, userId: string, ids: readonly string[], action: PolishAction) {
  if (ids.length === 0) return { updated: 0, rejected: 0 };
  const rows = await db
    .select()
    .from(resumePolishes)
    .where(and(eq(resumePolishes.userId, userId), inArray(resumePolishes.id, [...ids])));
  let updated = 0;
  let rejected = 0;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      if (action === "accept" && row.violations.length > 0) {
        rejected++;
        continue;
      }
      const set =
        action === "accept"
          ? { accepted: row.suggestion, status: "accepted" as const }
          : action === "revert"
            ? { accepted: null, status: "dismissed" as const }
            : { status: (row.accepted ? "accepted" : "dismissed") as PolishRow["status"] };
      await tx
        .update(resumePolishes)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(resumePolishes.id, row.id));
      updated++;
    }
  });
  return { updated, rejected };
}
