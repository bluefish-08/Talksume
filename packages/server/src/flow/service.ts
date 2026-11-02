import {
  APPLICATION_STATUSES,
  type ApplicationOutcome,
  type ApplicationStatus,
  type Notification,
  Profile,
  profileToResume,
  type StatusChange,
  type StatusSource,
} from "@talksume/core";
import { schema, type TransitionOptions } from "@talksume/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FlowContext } from "./context.ts";
import { HttpError, isUniqueViolation } from "./http.ts";

const { applications, applicationEvents, jobs, profiles, resumeVersions, users } = schema;

// 同一毫秒内的两条事件靠状态先后兜底排序（状态只会向前走）
const statusRank = sql`array_position(array[${sql.raw(APPLICATION_STATUSES.map((s) => `'${s}'`).join(","))}]::text[], ${applicationEvents.toStatus})`;

export const jobSummaryColumns = {
  id: jobs.id,
  source: jobs.source,
  company: jobs.company,
  title: jobs.title,
  cities: jobs.cities,
  jobType: jobs.jobType,
  url: jobs.url,
  status: jobs.status,
};

export const applicationColumns = {
  id: applications.id,
  status: applications.status,
  outcome: applications.outcome,
  channel: applications.channel,
  pitch: applications.pitch,
  resumeVersionId: applications.resumeVersionId,
  externalId: applications.externalId,
  createdAt: applications.createdAt,
  updatedAt: applications.updatedAt,
};

type EventRow = typeof applicationEvents.$inferSelect;

export function eventView(
  row: Pick<EventRow, "id" | "fromStatus" | "toStatus" | "outcome" | "source" | "payload" | "createdAt">,
) {
  const { note, interviewAt } = row.payload as { note?: string; interviewAt?: string };
  return {
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    outcome: row.outcome,
    source: row.source,
    note: note ?? null,
    interviewAt: interviewAt ?? null,
    createdAt: row.createdAt,
  };
}

export async function loadTimeline(ctx: FlowContext, applicationId: string) {
  const rows = await ctx.db
    .select()
    .from(applicationEvents)
    .where(eq(applicationEvents.applicationId, applicationId))
    .orderBy(asc(applicationEvents.createdAt), asc(statusRank));
  return rows.map(eventView);
}

async function publish(ctx: FlowContext, notification: Notification): Promise<void> {
  try {
    await ctx.notifier.notify(notification);
  } catch (err) {
    ctx.log.warn({ err }, "notification publish failed");
  }
}

/** 迁移 + 写通知同事务提交，提交后再推送；推送失败不回滚状态。 */
export async function move(
  ctx: FlowContext,
  applicationId: string,
  to: ApplicationStatus,
  source: StatusSource,
  outcome?: ApplicationOutcome,
  options?: TransitionOptions,
): Promise<StatusChange> {
  const { change, notification } = await ctx.repo.transitionAndNotify(
    applicationId,
    to,
    source,
    outcome,
    options,
  );
  if (notification) await publish(ctx, notification);
  return change;
}

export interface CreateApplicationInput {
  jobId: string;
  resumeVersionId?: string | undefined;
  pitch?: string | undefined;
}

/** 投递时冻结一份简历给 HR 看；画像没变就复用上一份快照。 */
async function snapshotResume(ctx: FlowContext, userId: string): Promise<string | null> {
  const [profile] = await ctx.db.select().from(profiles).where(eq(profiles.userId, userId));
  const [latest] = await ctx.db
    .select({ id: resumeVersions.id, profileVersion: resumeVersions.profileVersion })
    .from(resumeVersions)
    .where(eq(resumeVersions.userId, userId))
    .orderBy(desc(resumeVersions.createdAt))
    .limit(1);
  if (!profile) return latest?.id ?? null;
  if (latest && latest.profileVersion === profile.version) return latest.id;
  const [created] = await ctx.db
    .insert(resumeVersions)
    .values({
      userId,
      profileVersion: profile.version,
      template: "campus",
      content: profileToResume(Profile.parse(profile.data)),
    })
    .returning({ id: resumeVersions.id });
  return created?.id ?? null;
}

export async function createApplication(ctx: FlowContext, userId: string, input: CreateApplicationInput) {
  const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, input.jobId));
  if (!job) throw new HttpError(404, "job_not_found", "职位不存在");
  if (job.status !== "open") throw new HttpError(409, "job_closed", "职位已关闭");

  let resumeVersionId: string | null = null;
  if (input.resumeVersionId) {
    const [own] = await ctx.db
      .select({ id: resumeVersions.id })
      .from(resumeVersions)
      .where(and(eq(resumeVersions.id, input.resumeVersionId), eq(resumeVersions.userId, userId)));
    if (!own) throw new HttpError(404, "resume_not_found", "简历版本不存在");
    resumeVersionId = own.id;
  } else {
    resumeVersionId = await snapshotResume(ctx, userId);
  }

  const plan = ctx.connectors.resolve(job.source);
  let applicationId: string;
  try {
    applicationId = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(applications)
        .values({ userId, jobId: job.id, resumeVersionId, channel: plan.channel, pitch: input.pitch ?? null })
        .returning({ id: applications.id });
      if (!row) throw new Error("application insert failed");
      await tx.insert(applicationEvents).values({
        applicationId: row.id,
        fromStatus: null,
        toStatus: "pending",
        source: "user",
        createdAt: new Date(),
      });
      return row.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "already_applied", "已经投递过该职位");
    throw err;
  }

  let submitError: string | undefined;
  if (plan.channel === "hr_workspace") {
    await move(ctx, applicationId, "applied", "system");
  } else if (plan.channel === "platform_api") {
    try {
      const [user] = await ctx.db.select().from(users).where(eq(users.id, userId));
      const [resume] = resumeVersionId
        ? await ctx.db
            .select({ pdfKey: resumeVersions.pdfKey })
            .from(resumeVersions)
            .where(eq(resumeVersions.id, resumeVersionId))
        : [];
      const result = await plan.connector.submit({
        jobExternalId: job.sourceJobId,
        resumeFileKey: resume?.pdfKey ?? "",
        candidate: {
          name: user?.displayName ?? user?.email ?? "",
          ...(user?.email && { email: user.email }),
        },
      });
      await ctx.db
        .update(applications)
        .set({ externalId: result.externalId })
        .where(eq(applications.id, applicationId));
      await move(ctx, applicationId, "applied", "platform");
    } catch (err) {
      ctx.log.warn({ err, applicationId }, "platform submit failed, falling back to assisted");
      submitError = err instanceof Error ? err.message : String(err);
      await ctx.db
        .update(applications)
        .set({ channel: "assisted" })
        .where(eq(applications.id, applicationId));
    }
  }
  return { applicationId, submitError };
}

export async function loadCandidateDetail(ctx: FlowContext, userId: string, applicationId: string) {
  const [row] = await ctx.db
    .select({ application: applicationColumns, job: jobSummaryColumns })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)));
  if (!row) throw new HttpError(404, "not_found", "投递不存在");
  return { ...row, timeline: await loadTimeline(ctx, applicationId) };
}

export async function loadBoard(ctx: FlowContext, userId: string) {
  const rows = await ctx.db
    .select({ application: applicationColumns, job: jobSummaryColumns })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.updatedAt));

  const lastEvents = new Map<string, ReturnType<typeof eventView>>();
  if (rows.length > 0) {
    const events = await ctx.db
      .selectDistinctOn([applicationEvents.applicationId], {
        applicationId: applicationEvents.applicationId,
        id: applicationEvents.id,
        fromStatus: applicationEvents.fromStatus,
        toStatus: applicationEvents.toStatus,
        outcome: applicationEvents.outcome,
        source: applicationEvents.source,
        payload: applicationEvents.payload,
        createdAt: applicationEvents.createdAt,
      })
      .from(applicationEvents)
      .where(
        inArray(
          applicationEvents.applicationId,
          rows.map((r) => r.application.id),
        ),
      )
      .orderBy(applicationEvents.applicationId, desc(applicationEvents.createdAt), desc(statusRank));
    for (const e of events) lastEvents.set(e.applicationId, eventView(e));
  }

  const columns = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, [] as unknown[]]));
  for (const r of rows) {
    columns[r.application.status]?.push({
      ...r.application,
      job: r.job,
      lastEvent: lastEvents.get(r.application.id) ?? null,
    });
  }
  return { columns, total: rows.length };
}
