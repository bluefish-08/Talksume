import { isDeepStrictEqual } from "node:util";
import { applyTailoring, type Profile, profileToResume, type TailorChange } from "@talksume/core";
import { type Db, schema } from "@talksume/db";
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

export async function loadTailorJob(db: Db, jobId: string): Promise<TailorJob | null> {
  const [job] = await db
    .select({ id: jobs.id, company: jobs.company, title: jobs.title, jdText: jobs.jdText, tags: jobs.tags })
    .from(jobs)
    .where(eq(jobs.id, jobId));
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

/** 重新生成会替换草稿，但已采用的版本保留到用户再次采用或撤销为止。 */
export async function generateTailoring(
  db: Db,
  llm: StructuredLlm,
  userId: string,
  jobId: string,
  options: { profile?: Profile; quotes?: readonly string[]; signal?: AbortSignal } = {},
) {
  const job = await loadTailorJob(db, jobId);
  if (!job) throw new TailorError("job_not_found", "岗位不存在");
  const base = await mainResume(db, userId, options.profile);
  const tailorable = base.sections.some((s) => s.kind !== "education" && s.items.length > 0);
  if (!tailorable) throw new TailorError("profile_empty", "简历里还没有经历或技能，先和助手聊聊再来定制");
  const quotes = options.quotes ?? (await listFacts(db, userId)).map((f) => f.quote).filter(Boolean);
  const draft = await tailorWithLlm(llm, job, base, {
    quotes,
    ...(options.signal && { signal: options.signal }),
  });
  await db
    .insert(resumeTailorings)
    .values({ userId, jobId, baseContent: base, changes: draft.changes, model: draft.model })
    .onConflictDoUpdate({
      target: [resumeTailorings.userId, resumeTailorings.jobId],
      set: {
        baseContent: base,
        changes: draft.changes,
        selected: [],
        model: draft.model,
        updatedAt: new Date(),
      },
    });
  return { job, changes: draft.changes };
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
      .set({ selected: chosen.map((c) => c.id), resumeVersionId: created?.id ?? null, updatedAt: new Date() })
      .where(eq(resumeTailorings.id, row.id));
  });
  return { adopted: chosen.length, rejected: wanted.length - chosen.length };
}

export async function revokeTailoring(db: Db, userId: string, jobId: string) {
  await db
    .update(resumeTailorings)
    .set({ selected: [], resumeVersionId: null, updatedAt: new Date() })
    .where(and(eq(resumeTailorings.userId, userId), eq(resumeTailorings.jobId, jobId)));
}

export async function adoptedVersionFor(db: Db, userId: string, jobId: string): Promise<string | null> {
  const row = await loadRow(db, userId, jobId);
  return row?.resumeVersionId ?? null;
}

export async function tailoringView(db: Db, userId: string, jobId: string) {
  const job = await loadTailorJob(db, jobId);
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
