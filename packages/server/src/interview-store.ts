import {
  answerTurn,
  generateInterviewPrep,
  type InterviewLlm,
  type SessionContext,
  startSession,
  summarizeSession,
} from "@talksume/agent";
import {
  type InterviewQuestion,
  type InterviewSessionState,
  profileToResume,
  type ResumeContent,
  type ResumeSource,
  resumeBullets,
} from "@talksume/core";
import { type Db, schema } from "@talksume/db";
import { and, desc, eq, ne } from "drizzle-orm";
import { isUuid, listFacts, loadProfile } from "./conversation-store.ts";
import { polishedResume } from "./polish-store.ts";
import { loadTailorJob } from "./tailor-store.ts";

const { applications, interviewPreps, interviewSessions, resumeTailorings, resumeVersions } = schema;

export class InterviewError extends Error {
  readonly code: "job_not_found" | "not_found" | "profile_empty" | "no_prep" | "finished";

  constructor(code: InterviewError["code"], message: string) {
    super(message);
    this.name = "InterviewError";
    this.code = code;
  }
}

export interface ResumeChoice {
  source: ResumeSource;
  versionId: string | null;
  resume: ResumeContent;
}

async function versionContent(db: Db, userId: string, id: string | null | undefined) {
  if (!id) return undefined;
  const [row] = await db
    .select({ content: resumeVersions.content })
    .from(resumeVersions)
    .where(and(eq(resumeVersions.id, id), eq(resumeVersions.userId, userId)));
  return row?.content;
}

/** 面试官手里的简历：投递快照优先，其次这个岗位已采用的定制版，最后是当前简历。 */
export async function chooseResume(db: Db, userId: string, jobId: string): Promise<ResumeChoice> {
  const [app] = await db
    .select({ versionId: applications.resumeVersionId })
    .from(applications)
    .where(
      and(eq(applications.userId, userId), eq(applications.jobId, jobId), ne(applications.status, "pending")),
    );
  const snapshot = await versionContent(db, userId, app?.versionId);
  if (app?.versionId && snapshot)
    return { source: "application", versionId: app.versionId, resume: snapshot };

  const [tailoring] = await db
    .select({ versionId: resumeTailorings.resumeVersionId })
    .from(resumeTailorings)
    .where(and(eq(resumeTailorings.userId, userId), eq(resumeTailorings.jobId, jobId)));
  const tailored = await versionContent(db, userId, tailoring?.versionId);
  if (tailoring?.versionId && tailored) {
    return { source: "tailoring", versionId: tailoring.versionId, resume: tailored };
  }

  const { profile } = await loadProfile(db, userId);
  return {
    source: "current",
    versionId: null,
    resume: await polishedResume(db, userId, profileToResume(profile)),
  };
}

async function loadMaterials(db: Db, userId: string) {
  const [facts, { profile }] = await Promise.all([listFacts(db, userId), loadProfile(db, userId)]);
  const usable = facts.filter((f) => f.quote.trim());
  const intention = [...profile.intention.roles, ...profile.intention.cities].join("、");
  return { facts: usable.map((f) => ({ id: f.id, quote: f.quote })), intention };
}

export async function generatePrep(
  db: Db,
  llm: InterviewLlm,
  userId: string,
  jobId: string,
  signal?: AbortSignal,
) {
  const job = await loadTailorJob(db, userId, jobId);
  if (!job) throw new InterviewError("job_not_found", "岗位不存在");
  const choice = await chooseResume(db, userId, jobId);
  if (resumeBullets(choice.resume).length === 0) {
    throw new InterviewError("profile_empty", "简历里还没有经历或项目，先和助手聊聊再来准备面试");
  }
  const { facts, intention } = await loadMaterials(db, userId);
  const result = await generateInterviewPrep(llm, {
    job,
    resume: choice.resume,
    facts,
    ...(intention && { intention }),
    ...(signal && { signal }),
  });
  const values = {
    resumeSource: choice.source,
    resumeVersionId: choice.versionId,
    resume: choice.resume,
    questions: result.questions,
    model: result.model,
  };
  await db
    .insert(interviewPreps)
    .values({ userId, jobId, ...values })
    .onConflictDoUpdate({
      target: [interviewPreps.userId, interviewPreps.jobId],
      set: { ...values, updatedAt: new Date() },
    });
}

export async function prepView(db: Db, userId: string, jobId: string) {
  const job = await loadTailorJob(db, userId, jobId);
  if (!job) throw new InterviewError("job_not_found", "岗位不存在");
  const [[row], choice, sessions] = await Promise.all([
    db
      .select()
      .from(interviewPreps)
      .where(and(eq(interviewPreps.userId, userId), eq(interviewPreps.jobId, jobId))),
    chooseResume(db, userId, jobId),
    db
      .select({
        id: interviewSessions.id,
        state: interviewSessions.state,
        updatedAt: interviewSessions.updatedAt,
      })
      .from(interviewSessions)
      .where(and(eq(interviewSessions.userId, userId), eq(interviewSessions.jobId, jobId)))
      .orderBy(desc(interviewSessions.updatedAt))
      .limit(10),
  ]);
  return {
    job: { id: job.id, company: job.company, title: job.title },
    /** 现在会用来出题的简历来源，题单生成后它变了就提示重新生成。 */
    nextSource: choice.source,
    prep: row
      ? {
          resumeSource: row.resumeSource,
          questions: row.questions,
          model: row.model,
          updatedAt: row.updatedAt.toISOString(),
          stale: row.resumeSource !== choice.source || (row.resumeVersionId ?? null) !== choice.versionId,
        }
      : null,
    sessions: sessions.map((s) => ({
      id: s.id,
      status: s.state.status,
      answered: s.state.turns.filter((t) => t.role === "candidate").length,
      updatedAt: s.updatedAt.toISOString(),
    })),
  };
}

async function loadSession(db: Db, userId: string, sessionId: string) {
  if (!isUuid(sessionId)) throw new InterviewError("not_found", "面试不存在");
  const [row] = await db
    .select()
    .from(interviewSessions)
    .where(and(eq(interviewSessions.id, sessionId), eq(interviewSessions.userId, userId)));
  if (!row) throw new InterviewError("not_found", "面试不存在");
  return row;
}

async function sessionContext(
  db: Db,
  userId: string,
  jobId: string,
  questions: readonly InterviewQuestion[],
  signal?: AbortSignal,
): Promise<SessionContext> {
  const job = await loadTailorJob(db, userId, jobId);
  if (!job) throw new InterviewError("job_not_found", "岗位不存在");
  const { facts } = await loadMaterials(db, userId);
  return { job, questions, factQuotes: facts.map((f) => f.quote), ...(signal && { signal }) };
}

export interface SessionView {
  id: string;
  jobId: string;
  state: InterviewSessionState;
  questions: InterviewQuestion[];
  updatedAt: string;
}

const viewOf = (row: typeof interviewSessions.$inferSelect): SessionView => ({
  id: row.id,
  jobId: row.jobId,
  state: row.state,
  questions: row.questions,
  updatedAt: row.updatedAt.toISOString(),
});

export async function beginSession(db: Db, userId: string, jobId: string): Promise<SessionView> {
  const job = await loadTailorJob(db, userId, jobId);
  if (!job) throw new InterviewError("job_not_found", "岗位不存在");
  const [prep] = await db
    .select({ questions: interviewPreps.questions })
    .from(interviewPreps)
    .where(and(eq(interviewPreps.userId, userId), eq(interviewPreps.jobId, jobId)));
  if (!prep || prep.questions.length === 0)
    throw new InterviewError("no_prep", "先生成面试题单再开始模拟面试");
  const ctx = await sessionContext(db, userId, jobId, prep.questions);
  const state = startSession(ctx);
  const [row] = await db
    .insert(interviewSessions)
    .values({ userId, jobId, questions: prep.questions, state })
    .returning();
  if (!row) throw new Error("创建面试失败");
  return viewOf(row);
}

export async function getSession(db: Db, userId: string, sessionId: string): Promise<SessionView> {
  return viewOf(await loadSession(db, userId, sessionId));
}

async function save(db: Db, id: string, state: InterviewSessionState) {
  const [row] = await db
    .update(interviewSessions)
    .set({ state, updatedAt: new Date() })
    .where(eq(interviewSessions.id, id))
    .returning();
  if (!row) throw new InterviewError("not_found", "面试不存在");
  return viewOf(row);
}

/** 面试只写 interview_sessions，不碰画像和事实。 */
export async function answerSession(
  db: Db,
  llm: InterviewLlm,
  userId: string,
  sessionId: string,
  answer: string,
  signal?: AbortSignal,
): Promise<SessionView> {
  const row = await loadSession(db, userId, sessionId);
  if (row.state.status !== "active") throw new InterviewError("finished", "这场面试已经结束");
  const ctx = await sessionContext(db, userId, row.jobId, row.questions, signal);
  const { state } = await answerTurn(llm, ctx, row.state, answer);
  if (state.status === "finished") {
    const summary = await summarizeSession(llm, ctx, state).catch(() => undefined);
    if (summary) state.summary = summary;
  }
  return save(db, row.id, state);
}

export async function finishSession(
  db: Db,
  llm: InterviewLlm,
  userId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionView> {
  const row = await loadSession(db, userId, sessionId);
  if (row.state.status === "finished" && row.state.summary) return viewOf(row);
  const ctx = await sessionContext(db, userId, row.jobId, row.questions, signal);
  const state = structuredClone(row.state);
  state.status = "finished";
  state.summary = await summarizeSession(llm, ctx, state);
  return save(db, row.id, state);
}
