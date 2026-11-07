import { isDeepStrictEqual } from "node:util";
import {
  applyTailoring,
  DEFAULT_TAILOR_LEVEL,
  type Profile,
  profileToResume,
  type TailorChange,
  type TailorLevel,
} from "@talksume/core";
import { type Db, schema } from "@talksume/db";
import { visibleTo } from "@talksume/matching";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { listFacts, loadProfile } from "./conversation-store.ts";
import type { StructuredLlm } from "./polish-llm.ts";
import { polishedResume } from "./polish-store.ts";
import { loadResumeStyle } from "./resume-style.ts";
import { type TailorJob, tailorWithLlm } from "./tailor-llm.ts";

const { jobs, resumeTailorings, resumeVersions } = schema;
type TailorRow = typeof resumeTailorings.$inferSelect;

export class TailorError extends Error {
  readonly code: "job_not_found" | "profile_empty" | "no_changes" | "not_found";

  constructor(code: TailorError["code"], message: string) {
    super(message);
    this.name = "TailorError";
    this.code = code;
  }
}

export async function loadTailorJob(db: Db, userId: string, jobId: string): Promise<TailorJob | null> {
  const [job] = await db
    .select({ id: jobs.id, company: jobs.company, title: jobs.title, jdText: jobs.jdText, tags: jobs.tags })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), visibleTo(userId)));
  return job ?? null;
}

async function loadRow(db: Db, userId: string, jobId: string): Promise<TailorRow | undefined> {
  const [row] = await db
    .select()
    .from(resumeTailorings)
    .where(and(eq(resumeTailorings.userId, userId), eq(resumeTailorings.jobId, jobId)));
  return row;
}

/** 主简历来自画像加已采用的润色；对话里传入本轮内存中的画像，可能还没落库。 */
async function mainResume(db: Db, userId: string, profile?: Profile) {
  return polishedResume(db, userId, profileToResume(profile ?? (await loadProfile(db, userId)).profile));
}

export const usable = (c: TailorChange) => c.violations.length === 0;

export interface KeptTailoring {
  changes: TailorChange[];
  selected: string[];
  revoked: boolean;
  adopted: boolean;
}

/** 重新生成会替换草稿，但新草稿没有可用改动时保留之前那版。 */
export async function generateTailoring(
  db: Db,
  llm: StructuredLlm,
  userId: string,
  jobId: string,
  options: {
    profile?: Profile;
    quotes?: readonly string[];
    signal?: AbortSignal;
    level?: TailorLevel;
    conversationId?: string;
  } = {},
) {
  const job = await loadTailorJob(db, userId, jobId);
  if (!job) throw new TailorError("job_not_found", "岗位不存在");
  const existing = await loadRow(db, userId, jobId);
  const base = await mainResume(db, userId, options.profile);
  const tailorable = base.sections.some((s) => s.kind !== "education" && s.items.length > 0);
  if (!tailorable) throw new TailorError("profile_empty", "简历里还没有经历或技能，先和助手聊聊再来定制");
  const quotes = options.quotes ?? (await listFacts(db, userId)).map((f) => f.quote).filter(Boolean);
  const level = options.level ?? DEFAULT_TAILOR_LEVEL;
  const draft = await tailorWithLlm(llm, job, base, {
    quotes,
    ...(options.signal && { signal: options.signal }),
    ...(options.level && { level: options.level }),
  });
  if (existing && draft.changes.filter(usable).length === 0 && existing.changes.filter(usable).length > 0) {
    const kept: KeptTailoring = {
      changes: existing.changes,
      selected: existing.selected,
      revoked: existing.revokedAt !== null,
      adopted: existing.resumeVersionId !== null,
    };
    return { job, changes: draft.changes, level, kept };
  }
  await db
    .insert(resumeTailorings)
    .values({
      userId,
      jobId,
      baseContent: base,
      changes: draft.changes,
      model: draft.model,
      ...(options.conversationId && { conversationId: options.conversationId }),
    })
    .onConflictDoUpdate({
      target: [resumeTailorings.userId, resumeTailorings.jobId],
      set: {
        baseContent: base,
        changes: draft.changes,
        selected: [],
        revokedAt: null,
        model: draft.model,
        ...(options.conversationId && { conversationId: options.conversationId }),
        updatedAt: new Date(),
      },
    });
  return { job, changes: draft.changes, level };
}

/** 只采用 ids 里没有违规词的调整，冻结成一份针对该岗位的简历版本；主简历不受影响。 */
export async function adoptTailoring(db: Db, userId: string, jobId: string, ids: readonly string[]) {
  const row = await loadRow(db, userId, jobId);
  if (!row) throw new TailorError("not_found", "这个岗位还没有定制版");
  const wanted = row.changes.filter((c) => ids.includes(c.id));
  const chosen = wanted.filter(usable);
  if (chosen.length === 0) throw new TailorError("no_changes", "没有可采用的调整");
  const [{ version }, style] = await Promise.all([loadProfile(db, userId), loadResumeStyle(db, userId)]);
  const content = applyTailoring(row.baseContent, chosen);
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(resumeVersions)
      .values({
        userId,
        profileVersion: version,
        targetJobId: jobId,
        template: style.template,
        accent: style.accent,
        content,
      })
      .returning({ id: resumeVersions.id });
    await tx
      .update(resumeTailorings)
      .set({
        selected: chosen.map((c) => c.id),
        resumeVersionId: created?.id ?? null,
        revokedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(resumeTailorings.id, row.id));
  });
  return { adopted: chosen.length, rejected: wanted.length - chosen.length };
}

export interface TailoringSnapshot {
  job: TailorJob;
  changes: TailorChange[];
  selected: string[];
  conversationId: string | null;
}

export async function loadTailoring(
  db: Db,
  userId: string,
  jobId: string,
): Promise<TailoringSnapshot | null> {
  const [job, row] = await Promise.all([loadTailorJob(db, userId, jobId), loadRow(db, userId, jobId)]);
  if (!job) throw new TailorError("job_not_found", "岗位不存在");
  if (!row) return null;
  return { job, changes: row.changes, selected: row.selected, conversationId: row.conversationId };
}

/** 按话里的保留/去掉更新选中项；被拦下和未知的 id 只报告，不会写进选中。 */
export async function selectTailoring(
  db: Db,
  userId: string,
  jobId: string,
  options: { keep?: readonly string[]; drop?: readonly string[]; adopt?: boolean },
): Promise<TailoringSnapshot & { unknown: string[]; refused: string[] }> {
  const snapshot = await loadTailoring(db, userId, jobId);
  if (!snapshot) throw new TailorError("not_found", "这个岗位还没有定制版");
  const byId = new Map(snapshot.changes.map((c) => [c.id, c]));
  const selectable = new Set(snapshot.changes.filter(usable).map((c) => c.id));
  const requested = [...(options.keep ?? []), ...(options.drop ?? [])];
  const unknown = [...new Set(requested.filter((id) => !byId.has(id)))];
  const refused = [...new Set((options.keep ?? []).filter((id) => byId.has(id) && !selectable.has(id)))];
  const current =
    snapshot.selected.length > 0 ? snapshot.selected.filter((id) => selectable.has(id)) : [...selectable];
  const next = new Set(
    options.keep !== undefined ? options.keep.filter((id) => selectable.has(id)) : current,
  );
  for (const id of options.drop ?? []) next.delete(id);
  if (next.size === 0) throw new TailorError("no_changes", "至少要保留一处改动");

  const selected = [...next];
  if (options.adopt) await adoptTailoring(db, userId, jobId, selected);
  else
    await db
      .update(resumeTailorings)
      .set({ selected, revokedAt: null, updatedAt: new Date() })
      .where(and(eq(resumeTailorings.userId, userId), eq(resumeTailorings.jobId, jobId)));
  return { ...snapshot, selected, unknown, refused };
}

export async function revokeTailoring(db: Db, userId: string, jobId: string) {
  await db
    .update(resumeTailorings)
    .set({ selected: [], resumeVersionId: null, revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(resumeTailorings.userId, userId), eq(resumeTailorings.jobId, jobId)));
}

export async function adoptedVersionFor(db: Db, userId: string, jobId: string): Promise<string | null> {
  const row = await loadRow(db, userId, jobId);
  return row?.resumeVersionId ?? null;
}

export async function tailoringView(db: Db, userId: string, jobId: string) {
  const job = await loadTailorJob(db, userId, jobId);
  if (!job) throw new TailorError("job_not_found", "岗位不存在");
  const row = await loadRow(db, userId, jobId);
  const summary = { id: job.id, company: job.company, title: job.title };
  if (!row) return { job: summary, tailoring: null };
  const [current, adopted] = await Promise.all([
    mainResume(db, userId),
    row.resumeVersionId
      ? db
          .select({ id: resumeVersions.id, createdAt: resumeVersions.createdAt })
          .from(resumeVersions)
          .where(eq(resumeVersions.id, row.resumeVersionId))
      : Promise.resolve([]),
  ]);
  return {
    job: summary,
    tailoring: {
      base: row.baseContent,
      changes: row.changes,
      selected: row.selected,
      revoked: row.revokedAt !== null,
      conversationId: row.conversationId,
      adopted: adopted[0]
        ? { resumeVersionId: adopted[0].id, adoptedAt: adopted[0].createdAt.toISOString() }
        : null,
      /** 定制之后主简历又改过，草稿基于旧内容。 */
      stale: !isDeepStrictEqual(JSON.parse(JSON.stringify(current)), row.baseContent),
      updatedAt: row.updatedAt.toISOString(),
    },
  };
}

export async function listAdoptedTailorings(db: Db, userId: string) {
  const rows = await db
    .select({
      jobId: jobs.id,
      company: jobs.company,
      title: jobs.title,
      conversationId: resumeTailorings.conversationId,
      resumeVersionId: resumeVersions.id,
      adoptedAt: resumeVersions.createdAt,
    })
    .from(resumeTailorings)
    .innerJoin(jobs, eq(jobs.id, resumeTailorings.jobId))
    .innerJoin(resumeVersions, eq(resumeVersions.id, resumeTailorings.resumeVersionId))
    .where(and(eq(resumeTailorings.userId, userId), isNotNull(resumeTailorings.resumeVersionId)))
    .orderBy(desc(resumeVersions.createdAt));
  return rows.map((r) => ({ ...r, adoptedAt: r.adoptedAt.toISOString() }));
}
