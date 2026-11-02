import type { AddressInfo } from "node:net";
import type { Notification, PlatformConnector } from "@talksume/core";
import { createDb, type DbHandle, JobRepo, migrate, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { ConnectorRegistry } from "./flow/channels.ts";
import { InProcessNotifier, type NotificationBus } from "./notifications/bus.ts";
import { runReminderSweep } from "./notifications/reminders.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

// biome-ignore lint/suspicious/noExplicitAny: 测试里的响应体不做类型约束
type Json = any;
type Item = { kind: string; title: string; toStatus: string; fromStatus: string | null; source: string };

let handle: DbHandle;
let app: FastifyInstance;
let notifier: CountingNotifier;
let connectors: ConnectorRegistry;

class CountingNotifier extends InProcessNotifier {
  active = 0;
  override async subscribe(userId: string, listener: (n: Notification) => void) {
    const stop = await super.subscribe(userId, listener);
    this.active++;
    return () => {
      this.active--;
      stop();
    };
  }
}

beforeAll(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  notifier = new CountingNotifier();
  connectors = new ConnectorRegistry();
  app = buildApp({
    edition: "cloud",
    version: "t",
    db: handle.db,
    flow: { notifier: notifier as NotificationBus, connectors, sseHeartbeatMs: 30 },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await handle.close();
});

async function call(method: "GET" | "POST", url: string, userId: string, payload?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { "x-talksume-user": userId },
    ...(payload !== undefined && { payload: payload as object }),
  });
  return { status: res.statusCode, body: res.json() as Json };
}

async function newCandidate(name = "候选人") {
  const [user] = await handle.db
    .insert(schema.users)
    .values({ email: `${crypto.randomUUID()}@example.com`, displayName: name })
    .returning();
  return user?.id ?? "";
}

async function newHr() {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/dev/hr",
    payload: { email: `${crypto.randomUUID()}@corp.example.com`, displayName: "HR" },
  });
  return res.json().userId as string;
}

async function postJob(hrId: string, title = "后端开发实习生") {
  const res = await call("POST", "/api/v1/hr/jobs", hrId, {
    title,
    company: "腾讯",
    cities: ["深圳"],
    jobType: "internship",
    jdText: "负责服务端开发",
  });
  expect(res.status).toBe(201);
  return res.body.job.id as string;
}

async function externalJob(source = "tencent") {
  const id = crypto.randomUUID();
  await new JobRepo(handle.db).upsertMany([
    {
      id,
      source,
      sourceJobId: id,
      company: "字节跳动",
      title: "前端实习生",
      cities: [],
      jdText: "jd",
      tags: [],
      fetchedAt: new Date(),
    },
  ]);
  return id;
}

async function newResume(userId: string) {
  const [row] = await handle.db
    .insert(schema.resumeVersions)
    .values({
      userId,
      profileVersion: 1,
      content: { basics: { name: "张三", contacts: [] }, sections: [] },
    })
    .returning();
  return row?.id ?? "";
}

describe("投递全流程", () => {
  it("候选人投递 → HR 查看 → 面试中 → 录用，事件与通知齐全", async () => {
    const hr = await newHr();
    const candidate = await newCandidate("张三");
    const jobId = await postJob(hr);
    const resumeId = await newResume(candidate);

    const created = await call("POST", "/api/v1/applications", candidate, { jobId, pitch: "我很合适" });
    expect(created.status).toBe(201);
    expect(created.body.application).toMatchObject({
      status: "applied",
      channel: "hr_workspace",
      pitch: "我很合适",
      resumeVersionId: resumeId,
    });
    expect(created.body.nextAction).toBeNull();
    const appId = created.body.application.id as string;

    const board = await call("GET", "/api/v1/applications", candidate);
    expect(board.body.total).toBe(1);
    expect(board.body.columns.applied).toHaveLength(1);
    expect(board.body.columns.applied[0]).toMatchObject({
      id: appId,
      job: { company: "腾讯", title: "后端开发实习生" },
      lastEvent: { toStatus: "applied", source: "system" },
    });
    expect(board.body.columns.pending).toEqual([]);

    const incoming = await call("GET", `/api/v1/hr/applications?jobId=${jobId}`, hr);
    expect(incoming.body.items).toHaveLength(1);
    expect(incoming.body.items[0]).toMatchObject({
      application: { id: appId, status: "applied" },
      candidate: { displayName: "张三" },
      resume: { id: resumeId, content: { basics: { name: "张三" } } },
    });

    const detail = await call("GET", `/api/v1/hr/applications/${appId}`, hr);
    expect(detail.body.application.status).toBe("viewed");
    expect(detail.body.timeline.map((e: Item) => e.toStatus)).toEqual(["pending", "applied", "viewed"]);

    const interviewAt = new Date(Date.now() + 3 * DAY_MS).toISOString();
    const interviewing = await call("POST", `/api/v1/hr/applications/${appId}/status`, hr, {
      to: "interviewing",
      note: "一面",
      interviewAt,
    });
    expect(interviewing.status).toBe(200);
    expect(interviewing.body.application.status).toBe("interviewing");

    const closed = await call("POST", `/api/v1/hr/applications/${appId}/status`, hr, {
      to: "closed",
      outcome: "offer",
    });
    expect(closed.body.application).toMatchObject({ status: "closed", outcome: "offer" });

    const timeline = await call("GET", `/api/v1/applications/${appId}`, candidate);
    expect(timeline.body.timeline.map((e: Item) => [e.fromStatus, e.toStatus, e.source])).toEqual([
      [null, "pending", "user"],
      ["pending", "applied", "system"],
      ["applied", "viewed", "hr"],
      ["viewed", "interviewing", "hr"],
      ["interviewing", "closed", "hr"],
    ]);
    expect(timeline.body.timeline[3]).toMatchObject({ note: "一面", interviewAt });
    expect(timeline.body.timeline[4].outcome).toBe("offer");

    const list = await call("GET", "/api/v1/notifications", candidate);
    expect(list.body.unreadCount).toBe(3);
    expect(list.body.items.map((n: Item) => n.title)).toEqual([
      "「腾讯·后端开发实习生」状态更新为：已录用",
      "「腾讯·后端开发实习生」状态更新为：面试中",
      "「腾讯·后端开发实习生」状态更新为：已查看",
    ]);
    expect(list.body.items[0]).toMatchObject({ kind: "status_changed", refId: appId, readAt: null });

    const some = await call("POST", "/api/v1/notifications/read", candidate, {
      ids: [list.body.items[0].id],
    });
    expect(some.body).toEqual({ updated: 1, unreadCount: 2 });
    const all = await call("POST", "/api/v1/notifications/read", candidate, {});
    expect(all.body).toEqual({ updated: 2, unreadCount: 0 });

    const hrList = await call("GET", "/api/v1/hr/jobs", hr);
    expect(hrList.body.items[0]).toMatchObject({ id: jobId, applicationCount: 1, byStatus: { closed: 1 } });
  });

  it("外部职位走辅助投递：待投递 → 用户标记已投递 → 回填 → 撤回", async () => {
    const candidate = await newCandidate();
    const jobId = await externalJob();

    const created = await call("POST", "/api/v1/applications", candidate, { jobId });
    expect(created.body.application).toMatchObject({ status: "pending", channel: "assisted" });
    expect(created.body.nextAction).toBe("manual_apply");
    const id = created.body.application.id as string;

    const dup = await call("POST", "/api/v1/applications", candidate, { jobId });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("already_applied");

    const applied = await call("POST", `/api/v1/applications/${id}/mark-applied`, candidate, {});
    expect(applied.body.application.status).toBe("applied");
    const again = await call("POST", `/api/v1/applications/${id}/mark-applied`, candidate, {});
    expect(again.status).toBe(409);

    const viewed = await call("POST", `/api/v1/applications/${id}/status`, candidate, { to: "viewed" });
    expect(viewed.body.application.status).toBe("viewed");
    const noOutcome = await call("POST", `/api/v1/applications/${id}/status`, candidate, { to: "closed" });
    expect(noOutcome.status).toBe(400);

    const withdrawn = await call("POST", `/api/v1/applications/${id}/withdraw`, candidate, {});
    expect(withdrawn.body.application).toMatchObject({ status: "closed", outcome: "withdrawn" });
    expect(withdrawn.body.timeline.at(-1)).toMatchObject({ toStatus: "closed", source: "user" });
    const after = await call("POST", `/api/v1/applications/${id}/withdraw`, candidate, {});
    expect(after.status).toBe(409);
  });

  it("待投递的辅助投递也可以直接撤回", async () => {
    const candidate = await newCandidate();
    const created = await call("POST", "/api/v1/applications", candidate, { jobId: await externalJob() });
    const res = await call("POST", `/api/v1/applications/${created.body.application.id}/withdraw`, candidate);
    expect(res.body.application).toMatchObject({ status: "closed", outcome: "withdrawn" });
  });

  it("内部渠道不允许用户自行标记或回填状态", async () => {
    const hr = await newHr();
    const candidate = await newCandidate();
    const created = await call("POST", "/api/v1/applications", candidate, { jobId: await postJob(hr) });
    const id = created.body.application.id as string;
    expect((await call("POST", `/api/v1/applications/${id}/mark-applied`, candidate, {})).status).toBe(409);
    expect(
      (await call("POST", `/api/v1/applications/${id}/status`, candidate, { to: "viewed" })).status,
    ).toBe(403);
  });

  it("平台连接器投递成功记录 externalId，失败时降级为辅助投递", async () => {
    const ok: PlatformConnector = {
      platform: "feishu_hire",
      submit: async () => ({ externalId: "FS-1", status: "applied" }),
      fetchStatus: async () => null,
    };
    const broken: PlatformConnector = {
      platform: "broken_hire",
      submit: async () => {
        throw new Error("platform down");
      },
      fetchStatus: async () => null,
    };
    connectors.register("feishu_hire", ok).register("broken_hire", broken);
    const candidate = await newCandidate();

    const a = await call("POST", "/api/v1/applications", candidate, {
      jobId: await externalJob("feishu_hire"),
    });
    expect(a.body.application).toMatchObject({
      status: "applied",
      channel: "platform_api",
      externalId: "FS-1",
    });
    expect(a.body.timeline.at(-1).source).toBe("platform");

    const b = await call("POST", "/api/v1/applications", candidate, {
      jobId: await externalJob("broken_hire"),
    });
    expect(b.body.application).toMatchObject({ status: "pending", channel: "assisted" });
    expect(b.body.submitError).toBe("platform down");
    expect(b.body.nextAction).toBe("manual_apply");
  });

  it("职位或简历不存在时返回 404", async () => {
    const candidate = await newCandidate();
    expect((await call("POST", "/api/v1/applications", candidate, { jobId: "nope" })).status).toBe(404);
    const jobId = await externalJob();
    const other = await newCandidate();
    const foreignResume = await newResume(other);
    const res = await call("POST", "/api/v1/applications", candidate, {
      jobId,
      resumeVersionId: foreignResume,
    });
    expect(res.status).toBe(404);
    expect((await call("POST", "/api/v1/applications", candidate, {})).status).toBe(400);
  });
});

describe("权限", () => {
  it("非 HR 用户访问 HR 接口返回 403", async () => {
    const candidate = await newCandidate();
    for (const [method, url] of [
      ["GET", "/api/v1/hr/jobs"],
      ["POST", "/api/v1/hr/jobs"],
      ["GET", "/api/v1/hr/applications"],
      ["GET", `/api/v1/hr/applications/${crypto.randomUUID()}`],
      ["POST", `/api/v1/hr/applications/${crypto.randomUUID()}/status`],
    ] as const) {
      expect((await call(method, url, candidate, method === "POST" ? {} : undefined)).status).toBe(403);
    }
  });

  it("HR 只能处理自己职位的投递，候选人只能看自己的投递", async () => {
    const hrA = await newHr();
    const hrB = await newHr();
    const candidate = await newCandidate();
    const stranger = await newCandidate();
    const jobId = await postJob(hrA);
    const created = await call("POST", "/api/v1/applications", candidate, { jobId });
    const id = created.body.application.id as string;

    expect((await call("GET", `/api/v1/hr/applications/${id}`, hrB)).status).toBe(403);
    const forbidden = await call("POST", `/api/v1/hr/applications/${id}/status`, hrB, {
      to: "closed",
      outcome: "rejected",
    });
    expect(forbidden.status).toBe(403);
    expect((await call("GET", "/api/v1/hr/applications", hrB)).body.items).toEqual([]);
    expect((await call("GET", `/api/v1/hr/applications/${id}`, hrA)).body.application.status).toBe("viewed");

    expect((await call("GET", `/api/v1/applications/${id}`, stranger)).status).toBe(404);
    expect((await call("POST", `/api/v1/applications/${id}/withdraw`, stranger, {})).status).toBe(404);
    expect((await call("GET", "/api/v1/applications/not-a-uuid", candidate)).status).toBe(404);
    expect((await call("GET", "/api/v1/notifications", stranger)).body.items).toEqual([]);
  });

  it("没指定简历时按当前画像冻结一份快照，画像不变就复用", async () => {
    const hr = await newHr();
    const candidate = await newCandidate("李四");
    await handle.db.insert(schema.profiles).values({
      userId: candidate,
      data: {
        basics: { name: "李四" },
        education: [],
        experiences: [],
        projects: [],
        skills: [],
        awards: [],
        intention: { roles: [], cities: [] },
      },
      version: 3,
    });
    const first = await call("POST", "/api/v1/applications", candidate, { jobId: await postJob(hr, "前端") });
    const second = await call("POST", "/api/v1/applications", candidate, {
      jobId: await postJob(hr, "后端"),
    });
    const snapshotId = first.body.application.resumeVersionId as string;
    expect(snapshotId).toBeTruthy();
    expect(second.body.application.resumeVersionId).toBe(snapshotId);
    const incoming = await call("GET", `/api/v1/hr/applications?jobId=${first.body.job.id}`, hr);
    expect(incoming.body.items[0].resume).toMatchObject({
      template: "campus",
      accent: "blue",
      content: { basics: { name: "李四" } },
    });

    await handle.db
      .update(schema.users)
      .set({ resumeStyle: { template: "tech", accent: "teal" } })
      .where(eq(schema.users.id, candidate));
    const third = await call("POST", "/api/v1/applications", candidate, { jobId: await postJob(hr, "测试") });
    expect(third.body.application.resumeVersionId).not.toBe(snapshotId);
    const restyled = await call("GET", `/api/v1/hr/applications?jobId=${third.body.job.id}`, hr);
    expect(restyled.body.items[0].resume).toMatchObject({ template: "tech", accent: "teal" });
  });

  it("TALKSUME_DEMO=1 时生产环境也开放演示 HR 接口", async () => {
    const previous = { env: process.env.NODE_ENV, demo: process.env.TALKSUME_DEMO };
    process.env.NODE_ENV = "production";
    process.env.TALKSUME_DEMO = "1";
    try {
      const prod = buildApp({ edition: "cloud", version: "t", db: handle.db });
      const res = await prod.inject({ method: "POST", url: "/api/v1/dev/hr", payload: {} });
      expect(res.statusCode).toBe(200);
      await prod.close();
    } finally {
      process.env.NODE_ENV = previous.env;
      if (previous.demo === undefined) delete process.env.TALKSUME_DEMO;
      else process.env.TALKSUME_DEMO = previous.demo;
    }
  });

  it("生产环境不注册开发用的 HR 接口", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const prod = buildApp({ edition: "cloud", version: "t", db: handle.db });
      const res = await prod.inject({ method: "POST", url: "/api/v1/dev/hr", payload: {} });
      expect(res.statusCode).toBe(404);
      await prod.close();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe("非法迁移", () => {
  it("HR 跳步、回退、终态后再改都返回 409，缺 outcome 返回 400", async () => {
    const hr = await newHr();
    const candidate = await newCandidate();
    const created = await call("POST", "/api/v1/applications", candidate, { jobId: await postJob(hr) });
    const id = created.body.application.id as string;
    const url = `/api/v1/hr/applications/${id}/status`;

    const skip = await call("POST", url, hr, { to: "interviewing" });
    expect(skip.status).toBe(409);
    expect(skip.body.error).toBe("invalid_transition");
    expect((await call("POST", url, hr, { to: "applied" })).status).toBe(409);
    expect((await call("POST", url, hr, { to: "closed" })).status).toBe(400);
    expect((await call("POST", url, hr, { to: "viewed", outcome: "offer" })).status).toBe(400);
    expect((await call("POST", url, hr, { to: "closed", outcome: "withdrawn" })).status).toBe(400);
    expect((await call("POST", url, hr, { to: "bogus" })).status).toBe(400);

    await call("POST", url, hr, { to: "closed", outcome: "rejected" });
    expect((await call("POST", url, hr, { to: "interviewing" })).status).toBe(409);
    const detail = await call("GET", `/api/v1/applications/${id}`, candidate);
    expect(detail.body.timeline.at(-1)).toMatchObject({ toStatus: "closed", outcome: "rejected" });
  });
});

describe("SSE 推送", () => {
  it("推送 notification 事件、发心跳，断开后清理订阅", async () => {
    const hr = await newHr();
    const candidate = await newCandidate();
    const jobId = await postJob(hr);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;

    const before = notifier.active;
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/notifications/stream`, {
      headers: { "x-talksume-user": candidate },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(notifier.active).toBe(before + 1);

    const decoder = new TextDecoder();
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    let received = "";
    const readUntil = async (predicate: (text: string) => boolean) => {
      while (!predicate(received)) {
        const { value, done } = await reader.read();
        if (done) break;
        received += decoder.decode(value);
      }
    };

    await readUntil((t) => t.includes(": ping"));
    const created = await call("POST", "/api/v1/applications", candidate, { jobId });
    await call("GET", `/api/v1/hr/applications/${created.body.application.id}`, hr);
    await readUntil((t) => t.includes("event: notification"));

    expect(received).toContain("event: notification");
    const data = received.split("\n").find((l) => l.startsWith("data: "));
    const pushed = JSON.parse(data?.slice(6) ?? "{}") as Notification;
    expect(pushed).toMatchObject({
      userId: candidate,
      kind: "status_changed",
      title: "「腾讯·后端开发实习生」状态更新为：已查看",
    });
    expect(pushed.id).toBeTruthy();

    controller.abort();
    await expect.poll(() => notifier.active).toBe(before);
  });
});

describe("提醒扫描", () => {
  it("已投递满 7 天无动静只提醒一次，其余不受影响", async () => {
    const candidate = await newCandidate();
    const fresh = await newCandidate();
    const jobId = await externalJob();
    const a = await call("POST", "/api/v1/applications", candidate, { jobId });
    const b = await call("POST", "/api/v1/applications", fresh, { jobId });
    const aId = a.body.application.id as string;
    const bId = b.body.application.id as string;
    await call("POST", `/api/v1/applications/${aId}/mark-applied`, candidate, {});
    await call("POST", `/api/v1/applications/${bId}/mark-applied`, fresh, {});

    const seen: Notification[] = [];
    const stop = await notifier.subscribe(candidate, (n) => seen.push(n));

    const soon = await runReminderSweep(handle.db, new Date(Date.now() + 6 * DAY_MS), notifier);
    expect(soon.followUps).toBe(0);

    // fresh 的最近活动落在 later 之后，不应被提醒
    const later = new Date(Date.now() + 8 * DAY_MS);
    await handle.db
      .update(schema.applicationEvents)
      .set({ createdAt: new Date(later.getTime() + DAY_MS) })
      .where(eq(schema.applicationEvents.applicationId, bId));
    await handle.db
      .update(schema.applications)
      .set({ createdAt: new Date(later.getTime() + DAY_MS) })
      .where(eq(schema.applications.id, bId));

    const first = await runReminderSweep(handle.db, later, notifier);
    expect(first.followUps).toBeGreaterThanOrEqual(1);
    const second = await runReminderSweep(handle.db, later, notifier);
    expect(second).toEqual({ followUps: 0, interviewSoon: 0 });
    const third = await runReminderSweep(handle.db, new Date(later.getTime() + DAY_MS), notifier);
    expect(third.followUps).toBe(0);
    stop();

    const mine = await call("GET", "/api/v1/notifications", candidate);
    const followUps = mine.body.items.filter((n: Item) => n.kind === "follow_up");
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toMatchObject({ refId: aId });
    expect(followUps[0].title).toContain("字节跳动·前端实习生");
    expect(seen.filter((n) => n.kind === "follow_up")).toHaveLength(1);

    const theirs = await call("GET", "/api/v1/notifications", fresh);
    expect(theirs.body.items.filter((n: Item) => n.kind === "follow_up")).toHaveLength(0);
  });

  it("面试前 24 小时内提醒一次，时间太远或已过不提醒", async () => {
    const hr = await newHr();
    const soonUser = await newCandidate();
    const farUser = await newCandidate();
    const jobId = await postJob(hr);
    const ids: string[] = [];
    for (const user of [soonUser, farUser]) {
      const created = await call("POST", "/api/v1/applications", user, { jobId });
      ids.push(created.body.application.id as string);
    }
    const now = new Date();
    const interview = async (id: string, at: Date) => {
      await call("GET", `/api/v1/hr/applications/${id}`, hr);
      await call("POST", `/api/v1/hr/applications/${id}/status`, hr, {
        to: "interviewing",
        interviewAt: at.toISOString(),
      });
    };
    await interview(ids[0] ?? "", new Date(now.getTime() + 10 * 3600_000));
    await interview(ids[1] ?? "", new Date(now.getTime() + 3 * DAY_MS));

    const first = await runReminderSweep(handle.db, now, notifier);
    expect(first.interviewSoon).toBe(1);
    expect((await runReminderSweep(handle.db, now, notifier)).interviewSoon).toBe(0);

    const list = await call("GET", "/api/v1/notifications", soonUser);
    const reminders = list.body.items.filter((n: Item) => n.kind === "interview_soon");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].title).toContain("面试将在 24 小时内开始");
    const far = await call("GET", "/api/v1/notifications", farUser);
    expect(far.body.items.filter((n: Item) => n.kind === "interview_soon")).toHaveLength(0);
  });
});
