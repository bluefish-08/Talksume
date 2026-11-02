import type { Notification, Notifier } from "@talksume/core";
import { type Db, schema } from "@talksume/db";
import { and, desc, eq, sql } from "drizzle-orm";

const { applications, applicationEvents, jobs, notifications } = schema;

const DAY_MS = 24 * 60 * 60 * 1000;
export const FOLLOW_UP_AFTER_DAYS = 7;

type Reminder = Pick<Notification, "userId" | "kind" | "title" | "refId">;

// 唯一索引 (user, kind, ref) 保证多实例同时跑也只发一次；返回的只有真正新写入的
async function insertOnce(db: Db, items: Reminder[]): Promise<Notification[]> {
  if (items.length === 0) return [];
  const rows = await db.insert(notifications).values(items).onConflictDoNothing().returning();
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    userId: r.userId,
    kind: r.kind,
    title: r.title,
    refId: r.refId,
  }));
}

const formatTime = (date: Date) =>
  date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

async function followUps(db: Db, now: Date): Promise<Notification[]> {
  const cutoff = new Date(now.getTime() - FOLLOW_UP_AFTER_DAYS * DAY_MS).toISOString();
  const lastActivity = sql`coalesce((select max(${applicationEvents.createdAt}) from ${applicationEvents} where ${applicationEvents.applicationId} = ${applications.id}), ${applications.createdAt})`;
  const rows = await db
    .select({ id: applications.id, userId: applications.userId, company: jobs.company, title: jobs.title })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.status, "applied"), sql`${lastActivity} <= ${cutoff}::timestamptz`));
  return insertOnce(
    db,
    rows.map((r) => ({
      userId: r.userId,
      kind: "follow_up" as const,
      title: `「${r.company}·${r.title}」已投递超过 ${FOLLOW_UP_AFTER_DAYS} 天仍无回复，建议主动跟进`,
      refId: r.id,
    })),
  );
}

// 面试时间由 HR 推进到 interviewing 时写在事件 payload.interviewAt 里
async function interviewsSoon(db: Db, now: Date): Promise<Notification[]> {
  const rows = await db
    .select({
      id: applications.id,
      userId: applications.userId,
      company: jobs.company,
      title: jobs.title,
      payload: applicationEvents.payload,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(applicationEvents, eq(applicationEvents.applicationId, applications.id))
    .where(and(eq(applications.status, "interviewing"), eq(applicationEvents.toStatus, "interviewing")))
    .orderBy(desc(applicationEvents.createdAt));

  const seen = new Set<string>();
  const due: Reminder[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const raw = (r.payload as { interviewAt?: string }).interviewAt;
    const at = raw ? new Date(raw) : undefined;
    if (!at || Number.isNaN(at.getTime())) continue;
    const delta = at.getTime() - now.getTime();
    if (delta <= 0 || delta > DAY_MS) continue;
    due.push({
      userId: r.userId,
      kind: "interview_soon",
      title: `「${r.company}·${r.title}」面试将在 24 小时内开始（${formatTime(at)}）`,
      refId: r.id,
    });
  }
  return insertOnce(db, due);
}

export interface SweepResult {
  followUps: number;
  interviewSoon: number;
}

/** 幂等：同一个投递的同类提醒只会生成一次，可以放心定时重复调用。 */
export async function runReminderSweep(
  db: Db,
  now: Date = new Date(),
  notifier?: Notifier,
): Promise<SweepResult> {
  const created = [...(await followUps(db, now)), ...(await interviewsSoon(db, now))];
  if (notifier) {
    for (const n of created) await notifier.notify(n).catch(() => undefined);
  }
  return {
    followUps: created.filter((n) => n.kind === "follow_up").length,
    interviewSoon: created.filter((n) => n.kind === "interview_soon").length,
  };
}
