import {
  type ApplicationOutcome,
  type ApplicationStatus,
  type Notification,
  type StatusChange,
  type StatusSource,
  statusChangeTitle,
  transition,
} from "@talksume/core";
import { and, eq } from "drizzle-orm";
import type { Db } from "./client.ts";
import { applicationEvents, applications, jobs, notifications } from "./schema.ts";

export class ApplicationNotFoundError extends Error {
  readonly applicationId: string;

  constructor(applicationId: string) {
    super(`投递 ${applicationId} 不存在`);
    this.name = "ApplicationNotFoundError";
    this.applicationId = applicationId;
  }
}

/** 投递状态在读取之后已被别人改过，调用方应重新读取再决定是否重试。 */
export class ConcurrentTransitionError extends Error {
  readonly applicationId: string;
  readonly expected: ApplicationStatus;
  readonly actual: ApplicationStatus | undefined;

  constructor(applicationId: string, expected: ApplicationStatus, actual?: ApplicationStatus) {
    super(`投递 ${applicationId} 的状态已被修改（期望 ${expected}，实际 ${actual ?? "未知"}）`);
    this.name = "ConcurrentTransitionError";
    this.applicationId = applicationId;
    this.expected = expected;
    this.actual = actual;
  }
}

export interface TransitionOptions {
  /** 调用方上次看到的状态；与库中当前状态不一致时抛 ConcurrentTransitionError。 */
  expectedFrom?: ApplicationStatus;
  /** 写入事件的附加信息，如 HR 备注、面试时间。 */
  payload?: Record<string, unknown>;
}

export interface TransitionResult {
  change: StatusChange;
  notification: Notification & { id: string; createdAt: string };
}

export class ApplicationRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async transition(
    applicationId: string,
    to: ApplicationStatus,
    source: StatusSource,
    outcome?: ApplicationOutcome,
    options: TransitionOptions = {},
  ): Promise<StatusChange> {
    return (await this.transitionAndNotify(applicationId, to, source, outcome, options)).change;
  }

  /** 状态、事件、候选人通知在同一事务里落库；调用方在提交后再把返回的通知推给在线连接。 */
  async transitionAndNotify(
    applicationId: string,
    to: ApplicationStatus,
    source: StatusSource,
    outcome?: ApplicationOutcome,
    options: TransitionOptions = {},
  ): Promise<TransitionResult> {
    return this.#db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          status: applications.status,
          userId: applications.userId,
          company: jobs.company,
          jobTitle: jobs.title,
        })
        .from(applications)
        .innerJoin(jobs, eq(jobs.id, applications.jobId))
        .where(eq(applications.id, applicationId));
      if (!current) throw new ApplicationNotFoundError(applicationId);

      const { expectedFrom } = options;
      if (expectedFrom !== undefined && expectedFrom !== current.status) {
        throw new ConcurrentTransitionError(applicationId, expectedFrom, current.status);
      }

      const change = transition(current.status, to, source, outcome);

      const updated = await tx
        .update(applications)
        .set({ status: to, outcome: change.outcome ?? null, updatedAt: change.at })
        .where(and(eq(applications.id, applicationId), eq(applications.status, change.from)))
        .returning({ id: applications.id });
      if (updated.length === 0) throw new ConcurrentTransitionError(applicationId, change.from);

      await tx.insert(applicationEvents).values({
        applicationId,
        fromStatus: change.from,
        toStatus: change.to,
        outcome: change.outcome ?? null,
        source: change.source,
        payload: options.payload ?? {},
        createdAt: change.at,
      });

      const title = statusChangeTitle(current.company, current.jobTitle, change.to, change.outcome);
      const [row] = await tx
        .insert(notifications)
        .values({ userId: current.userId, kind: "status_changed", title, refId: applicationId })
        .returning();
      if (!row) throw new Error("notification insert failed");
      return {
        change,
        notification: {
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          userId: row.userId,
          kind: "status_changed",
          title,
          refId: applicationId,
        },
      };
    });
  }
}
