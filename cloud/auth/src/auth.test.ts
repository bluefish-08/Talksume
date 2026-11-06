import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { buildApp } from "@talksume/server";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCloudIdentity } from "./identity.ts";
import { migrateCloudAuth } from "./index.ts";
import { MemoryMailer } from "./mailer.ts";
import { authSessions } from "./schema.ts";

const ORIGIN = "https://talksume.example.com";
const PASSWORD = "correct-horse-1";
const FAST_SCRYPT = { N: 2 ** 10, r: 8, p: 1 };

let handle: DbHandle;
let app: FastifyInstance;
let mailer: MemoryMailer;

async function boot(auth: Record<string, unknown> = {}) {
  mailer = new MemoryMailer();
  app = buildApp({
    edition: "cloud",
    version: "t",
    db: handle.db,
    identity: createCloudIdentity(handle.db, {
      emailEnabled: true,
      production: true,
      appUrl: ORIGIN,
      mailer,
      scrypt: FAST_SCRYPT,
      adminEmails: ["boss@example.com"],
      ...auth,
    }),
  });
  await app.ready();
}

beforeEach(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  await migrateCloudAuth(handle);
});

afterEach(async () => {
  await app?.close();
  await handle.close();
});

interface Call {
  method?: "GET" | "POST" | "DELETE" | "PATCH" | "PUT";
  cookie?: string;
  body?: unknown;
  origin?: string | null;
  headers?: Record<string, string>;
}

async function call(url: string, { method = "GET", cookie, body, origin = ORIGIN, headers = {} }: Call = {}) {
  const res = await app.inject({
    method,
    url,
    headers: { ...(origin && { origin }), ...(cookie && { cookie }), ...headers },
    ...(body !== undefined && { payload: body as object }),
  });
  const setCookie = res.headers["set-cookie"];
  return {
    status: res.statusCode,
    // biome-ignore lint/suspicious/noExplicitAny: 各接口响应体形状不同
    json: (res.body ? res.json() : {}) as Record<string, any>,
    setCookie: Array.isArray(setCookie) ? setCookie[0] : setCookie,
    headers: res.headers,
  };
}

const post = (url: string, body: unknown, extra: Call = {}) => call(url, { method: "POST", body, ...extra });

const tokenFrom = (mail: { text: string } | undefined) => {
  const match = mail?.text.match(/token=([^\s]+)/);
  if (!match?.[1]) throw new Error(`mail has no link: ${mail?.text}`);
  return decodeURIComponent(match[1]);
};

async function register(email: string, extra: Record<string, unknown> = {}) {
  const res = await post("/api/v1/auth/register", { email, password: PASSWORD, ...extra });
  expect(res.status).toBe(202);
  return tokenFrom(mailer.last(email));
}

async function login(email: string, password = PASSWORD) {
  const res = await post("/api/v1/auth/login", { email, password });
  return { ...res, cookie: res.setCookie?.split(";")[0] ?? "" };
}

async function signup(email: string, extra: Record<string, unknown> = {}) {
  const token = await register(email, extra);
  expect((await post("/api/v1/auth/verify-email", { token })).status).toBe(200);
  const res = await login(email);
  expect(res.status).toBe(200);
  return { cookie: res.cookie, id: res.json.user.id as string };
}

describe("邮件开关打开时的配置", () => {
  it("公开的 config 接口返回 emailEnabled=true", async () => {
    await boot();
    const res = await call("/api/v1/auth/config");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ emailEnabled: true });
  });

  it("生产模式缺 APP_URL 启动报错", () => {
    expect(() => createCloudIdentity(handle.db, { emailEnabled: true, production: true, mailer })).toThrow(
      /APP_URL/,
    );
  });
});

describe("注册、验证、登录、退出", () => {
  it("走完整个流程，验证前不能用业务功能", async () => {
    await boot();
    const token = await register("liming@example.com", { displayName: "李明" });
    expect(mailer.last()?.subject).toContain("验证");

    const early = await login("liming@example.com");
    expect(early.status).toBe(200);
    expect(early.json.user).toMatchObject({
      email: "liming@example.com",
      emailVerified: false,
      role: "seeker",
    });
    expect((await call("/api/v1/auth/me", { cookie: early.cookie })).status).toBe(200);
    const blocked = await call("/api/v1/conversations", { cookie: early.cookie });
    expect(blocked.status).toBe(403);
    expect(blocked.json.error).toBe("email_not_verified");

    expect((await post("/api/v1/auth/verify-email", { token })).status).toBe(200);
    expect((await call("/api/v1/conversations", { cookie: early.cookie })).status).toBe(401);

    const session = await login("liming@example.com");
    expect((await call("/api/v1/conversations", { cookie: session.cookie })).status).toBe(200);
    const me = await call("/api/v1/auth/me", { cookie: session.cookie });
    expect(me.json.user).toMatchObject({ displayName: "李明", emailVerified: true });

    expect((await post("/api/v1/auth/logout", {}, { cookie: session.cookie })).status).toBe(200);
    expect((await call("/api/v1/conversations", { cookie: session.cookie })).status).toBe(401);
  });

  it("Cookie 是 HttpOnly、SameSite=Lax，生产环境带 Secure，库里只存哈希", async () => {
    await boot();
    await signup("liming@example.com");
    const res = await login("liming@example.com");
    expect(res.setCookie).toMatch(/HttpOnly/);
    expect(res.setCookie).toMatch(/SameSite=Lax/);
    expect(res.setCookie).toMatch(/Secure/);
    expect(res.setCookie).toMatch(/Max-Age=\d+/);
    const rawToken = res.cookie.split("=")[1] ?? "";
    const rows = await handle.db.select().from(authSessions);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tokenHash !== rawToken && r.tokenHash.length === 64)).toBe(true);
    const [user] = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "liming@example.com"));
    expect(user?.passwordHash).toMatch(/^scrypt\$/);
    expect(user?.passwordHash).not.toContain(PASSWORD);
  });

  it("密码少于 8 位被拒绝", async () => {
    await boot();
    const res = await post("/api/v1/auth/register", { email: "liming@example.com", password: "short" });
    expect(res.status).toBe(400);
  });

  it("验证链接一次性、24 小时过期", async () => {
    await boot();
    const token = await register("liming@example.com");
    expect((await post("/api/v1/auth/verify-email", { token })).status).toBe(200);
    expect((await post("/api/v1/auth/verify-email", { token })).status).toBe(400);

    const second = await register("wanger@example.com");
    await handle.db.execute(sql`update auth_tokens set expires_at = now() - interval '1 minute'`);
    expect((await post("/api/v1/auth/verify-email", { token: second })).status).toBe(400);
  });

  it("可以重发验证邮件，旧链接失效，并受频率限制", async () => {
    await boot();
    const first = await register("liming@example.com");
    for (let i = 0; i < 3; i++) {
      expect((await post("/api/v1/auth/resend-verification", { email: "liming@example.com" })).status).toBe(
        202,
      );
    }
    const latest = tokenFrom(mailer.last("liming@example.com"));
    expect(latest).not.toBe(first);
    expect((await post("/api/v1/auth/verify-email", { token: first })).status).toBe(400);
    const limited = await post("/api/v1/auth/resend-verification", { email: "liming@example.com" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect((await post("/api/v1/auth/verify-email", { token: latest })).status).toBe(200);
  });

  it("未验证账号被别人重新注册时覆盖密码并踢掉旧会话", async () => {
    await boot();
    await register("liming@example.com");
    const squatter = await login("liming@example.com");
    const owner = await post("/api/v1/auth/register", {
      email: "liming@example.com",
      password: "owner-password-2",
    });
    expect(owner.status).toBe(202);
    expect((await call("/api/v1/auth/me", { cookie: squatter.cookie })).status).toBe(401);
    expect((await login("liming@example.com")).status).toBe(401);
    expect((await login("liming@example.com", "owner-password-2")).status).toBe(200);
  });
});

describe("不泄露邮箱是否已注册", () => {
  it("登录失败、注册重复邮箱、找回密码对存在与否给同样的响应", async () => {
    await boot();
    await signup("liming@example.com");
    const wrong = await login("liming@example.com", "wrong-password");
    const unknown = await login("nobody@example.com", "wrong-password");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json).toEqual(unknown.json);

    const dup = await post("/api/v1/auth/register", { email: "liming@example.com", password: PASSWORD });
    const fresh = await post("/api/v1/auth/register", { email: "new@example.com", password: PASSWORD });
    expect(dup.status).toBe(fresh.status);
    expect(dup.json).toEqual(fresh.json);
    expect(mailer.last("liming@example.com")?.subject).toContain("已注册");

    const before = mailer.sent.length;
    const ghost = await post("/api/v1/auth/forgot-password", { email: "nobody@example.com" });
    const real = await post("/api/v1/auth/forgot-password", { email: "liming@example.com" });
    expect(ghost.status).toBe(real.status);
    expect(ghost.json).toEqual(real.json);
    expect(mailer.sent.length).toBe(before + 1);
  });
});

describe("找回与修改密码", () => {
  it("重置后旧会话失效，链接一次性，重置密码后可用新密码登录", async () => {
    await boot();
    const old = await signup("liming@example.com");
    const other = await login("liming@example.com");
    await post("/api/v1/auth/forgot-password", { email: "liming@example.com" });
    const token = tokenFrom(mailer.last("liming@example.com"));

    const reset = await post("/api/v1/auth/reset-password", { token, password: "brand-new-pass-3" });
    expect(reset.status).toBe(200);
    expect((await call("/api/v1/conversations", { cookie: old.cookie })).status).toBe(401);
    expect((await call("/api/v1/conversations", { cookie: other.cookie })).status).toBe(401);
    expect((await post("/api/v1/auth/reset-password", { token, password: "another-pass-44" })).status).toBe(
      400,
    );
    expect((await login("liming@example.com")).status).toBe(401);
    expect((await login("liming@example.com", "brand-new-pass-3")).status).toBe(200);
  });

  it("重置链接 1 小时过期", async () => {
    await boot();
    await signup("liming@example.com");
    await post("/api/v1/auth/forgot-password", { email: "liming@example.com" });
    const token = tokenFrom(mailer.last("liming@example.com"));
    await handle.db.execute(sql`update auth_tokens set expires_at = now() - interval '1 second'`);
    expect((await post("/api/v1/auth/reset-password", { token, password: "brand-new-pass-3" })).status).toBe(
      400,
    );
  });

  it("改密码要旧密码，并踢掉其他会话但保留当前会话", async () => {
    await boot();
    const mine = await signup("liming@example.com");
    const elsewhere = await login("liming@example.com");
    const bad = await post(
      "/api/v1/auth/change-password",
      { oldPassword: "nope-nope-1", newPassword: "brand-new-pass-3" },
      { cookie: mine.cookie },
    );
    expect(bad.status).toBe(403);
    const ok = await post(
      "/api/v1/auth/change-password",
      { oldPassword: PASSWORD, newPassword: "brand-new-pass-3" },
      { cookie: mine.cookie },
    );
    expect(ok.status).toBe(200);
    expect((await call("/api/v1/auth/me", { cookie: mine.cookie })).status).toBe(200);
    expect((await call("/api/v1/auth/me", { cookie: elsewhere.cookie })).status).toBe(401);
  });
});

describe("限流", () => {
  it("同一邮箱登录连续失败后返回 429", async () => {
    await boot();
    await signup("liming@example.com");
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await login("liming@example.com", "wrong-password")).status);
    expect(statuses.slice(0, 9).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(9)).toEqual([429, 429]);
    expect((await login("liming@example.com")).status).toBe(429);
  });

  it("同一 IP 的注册请求也被限制", async () => {
    await boot();
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await post("/api/v1/auth/register", { email: `user${i}@example.com`, password: PASSWORD }))
        .status;
    }
    expect(last).toBe(429);
  });

  it("找回密码按邮箱限流，发信不会超过上限", async () => {
    await boot();
    await signup("liming@example.com");
    const before = mailer.sent.length;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++)
      statuses.push((await post("/api/v1/auth/forgot-password", { email: "liming@example.com" })).status);
    expect(statuses).toEqual([202, 202, 202, 429, 429]);
    expect(mailer.sent.length - before).toBe(3);
  });
});

describe("会话与 CSRF", () => {
  it("改变状态的请求必须带允许的 Origin", async () => {
    await boot();
    const { cookie } = await signup("liming@example.com");
    const evil = await post("/api/v1/conversations", {}, { cookie, origin: "https://evil.example.org" });
    expect(evil.status).toBe(403);
    const none = await post("/api/v1/conversations", {}, { cookie, origin: null });
    expect(none.status).toBe(403);
    const ok = await post("/api/v1/conversations", {}, { cookie });
    expect(ok.status).toBe(201);
    expect(
      (
        await post(
          "/api/v1/auth/login",
          { email: "liming@example.com", password: PASSWORD },
          { origin: "https://evil.example.org" },
        )
      ).status,
    ).toBe(403);
    expect((await call("/api/v1/conversations", { cookie, origin: "https://evil.example.org" })).status).toBe(
      200,
    );
  });

  it("会话过期后失效，临近过期的会话访问时续期并重发 Cookie", async () => {
    await boot();
    const { cookie } = await signup("liming@example.com");
    await handle.db.execute(
      sql`update auth_sessions set last_seen_at = now() - interval '1 hour', expires_at = now() + interval '1 day'`,
    );
    const renewed = await call("/api/v1/auth/me", { cookie });
    expect(renewed.status).toBe(200);
    expect(renewed.setCookie).toMatch(/Max-Age=/);
    const [row] = await handle.db.select().from(authSessions);
    expect((row?.expiresAt.getTime() ?? 0) - Date.now()).toBeGreaterThan(20 * 24 * 3600_000);

    await handle.db.execute(sql`update auth_sessions set expires_at = now() - interval '1 second'`);
    expect((await call("/api/v1/auth/me", { cookie })).status).toBe(401);
  });
});

describe("生产模式没有后门", () => {
  it("x-talksume-user 头无效，没有身份也不会落到演示用户", async () => {
    await boot();
    const [victim] = await handle.db
      .insert(schema.users)
      .values({ email: "victim@example.com" })
      .returning({ id: schema.users.id });
    const forged = await call("/api/v1/conversations", { headers: { "x-talksume-user": victim?.id ?? "" } });
    expect(forged.status).toBe(401);
    expect((await call("/api/v1/conversations")).status).toBe(401);
    const demo = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "demo@talksume.local"));
    expect(demo).toHaveLength(0);
    expect((await call("/api/v1/meta")).status).toBe(200);
  });

  it("生产模式没配 SMTP 时启动报错", () => {
    const saved = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      expect(() =>
        createCloudIdentity(handle.db, { emailEnabled: true, production: true, appUrl: ORIGIN }),
      ).toThrow(/SMTP/);
    } finally {
      if (saved !== undefined) process.env.SMTP_HOST = saved;
    }
  });
});

describe("跨用户访问", () => {
  it("别人的会话和投递返回 404，列表里看不到别人的数据", async () => {
    await boot();
    const alice = await signup("alice@example.com");
    const bob = await signup("bob@example.com");
    const created = await post("/api/v1/conversations", {}, { cookie: alice.cookie });
    const id = created.json.id as string;
    expect((await call(`/api/v1/conversations/${id}`, { cookie: alice.cookie })).status).toBe(200);
    expect((await call(`/api/v1/conversations/${id}`, { cookie: bob.cookie })).status).toBe(404);
    expect((await call(`/api/v1/conversations/${id}`, { method: "DELETE", cookie: bob.cookie })).status).toBe(
      404,
    );
    const bobList = await call("/api/v1/conversations", { cookie: bob.cookie });
    expect(JSON.stringify(bobList.json)).not.toContain(id);

    const [job] = await handle.db.select({ id: schema.jobs.id }).from(schema.jobs).limit(1);
    const hr = await signup("hr@example.com");
    await handle.db.update(schema.users).set({ role: "hr" }).where(eq(schema.users.id, hr.id));
    const posted = await post(
      "/api/v1/hr/jobs",
      { title: "前端工程师", company: "示例科技", jdText: "负责前端开发" },
      { cookie: hr.cookie },
    );
    expect(posted.status).toBe(201);
    const applied = await post(
      "/api/v1/applications",
      { jobId: posted.json.job.id },
      { cookie: alice.cookie },
    );
    expect(applied.status).toBe(201);
    const appId = applied.json.application.id as string;
    expect((await call(`/api/v1/applications/${appId}`, { cookie: alice.cookie })).status).toBe(200);
    expect((await call(`/api/v1/applications/${appId}`, { cookie: bob.cookie })).status).toBe(404);
    expect((await post(`/api/v1/applications/${appId}/withdraw`, {}, { cookie: bob.cookie })).status).toBe(
      404,
    );
    void job;
  });
});

describe("别人导入的私有岗位", () => {
  it("不能投递、也不能生成定制简历", async () => {
    await boot();
    const owner = await signup("alice@example.com");
    const stranger = await signup("bob@example.com");
    const jobId = `user_import:${owner.id}:abc`;
    await handle.db.insert(schema.jobs).values({
      id: jobId,
      source: "user_import",
      sourceJobId: `${owner.id}:abc`,
      company: "示例科技",
      title: "私有岗位",
      jdText: "jd",
      fetchedAt: new Date(),
    });
    expect((await post("/api/v1/applications", { jobId }, { cookie: stranger.cookie })).status).toBe(404);
    expect(
      (await call(`/api/v1/jobs/${encodeURIComponent(jobId)}`, { cookie: stranger.cookie })).status,
    ).toBe(404);
    expect(
      (await call(`/api/v1/jobs/${encodeURIComponent(jobId)}/tailoring`, { cookie: stranger.cookie })).status,
    ).toBe(404);
    expect((await call(`/api/v1/jobs/${encodeURIComponent(jobId)}`, { cookie: owner.cookie })).status).toBe(
      200,
    );
  });
});

describe("角色与 HR 接口权限", () => {
  it("seeker 不能访问 HR 和管理员接口，hr 和 admin 可以进 HR 接口", async () => {
    await boot();
    const seeker = await signup("seeker@example.com");
    const hr = await signup("hr@example.com");
    await handle.db.update(schema.users).set({ role: "hr" }).where(eq(schema.users.id, hr.id));
    const admin = await signup("boss@example.com");
    expect((await call("/api/v1/auth/me", { cookie: admin.cookie })).json.user.role).toBe("admin");

    expect((await call("/api/v1/hr/jobs", { cookie: seeker.cookie })).status).toBe(403);
    expect((await call("/api/v1/hr/applications", { cookie: seeker.cookie })).status).toBe(403);
    expect((await call("/api/v1/hr/jobs", { cookie: hr.cookie })).status).toBe(200);
    expect((await call("/api/v1/hr/jobs", { cookie: admin.cookie })).status).toBe(200);
    expect((await call("/api/v1/hr/jobs")).status).toBe(401);

    expect((await call("/api/v1/admin/hr-invitations", { cookie: seeker.cookie })).status).toBe(403);
    expect((await call("/api/v1/admin/hr-invitations", { cookie: hr.cookie })).status).toBe(403);
    expect((await call("/api/v1/admin/hr-invitations", { cookie: admin.cookie })).status).toBe(200);
    expect((await post("/api/v1/admin/hr-invitations", {}, { cookie: hr.cookie })).status).toBe(403);
  });

  it("只有 ADMIN_EMAILS 里的邮箱验证后才成为管理员", async () => {
    await boot();
    const token = await register("boss@example.com");
    const [before] = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "boss@example.com"));
    expect(before?.role).toBe("seeker");
    await post("/api/v1/auth/verify-email", { token });
    const [after] = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "boss@example.com"));
    expect(after?.role).toBe("admin");
    const other = await signup("someone@example.com");
    expect((await call("/api/v1/auth/me", { cookie: other.cookie })).json.user.role).toBe("seeker");
  });
});

describe("HR 邀请", () => {
  const invite = async (cookie: string, body: Record<string, unknown> = {}) => {
    const res = await post("/api/v1/admin/hr-invitations", body, { cookie });
    expect(res.status).toBe(201);
    return {
      id: res.json.id as string,
      link: res.json.link as string,
      token: tokenFrom({ text: res.json.link as string }),
    };
  };

  it("新用户通过邀请链接注册，验证邮箱后成为 hr；链接只能用一次", async () => {
    await boot();
    const admin = await signup("boss@example.com");
    const created = await invite(admin.cookie, { note: "示例科技 招聘" });
    expect(created.link).toContain(`${ORIGIN}/invite?token=`);

    expect((await call(`/api/v1/auth/invitations/peek?token=${created.token}`)).status).toBe(200);
    const hrToken = await register("hr1@example.com", { invitationToken: created.token });
    const [pending] = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "hr1@example.com"));
    expect(pending?.role).toBe("seeker");
    await post("/api/v1/auth/verify-email", { token: hrToken });
    const [hr1] = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "hr1@example.com"));
    expect(hr1?.role).toBe("hr");

    expect((await call(`/api/v1/auth/invitations/peek?token=${created.token}`)).status).toBe(400);
    const again = await post("/api/v1/auth/register", {
      email: "hr2@example.com",
      password: PASSWORD,
      invitationToken: created.token,
    });
    expect(again.status).toBe(400);
    const seeker = await signup("seeker@example.com");
    expect(
      (await post("/api/v1/auth/invitations/accept", { token: created.token }, { cookie: seeker.cookie }))
        .status,
    ).toBe(400);

    const list = await call("/api/v1/admin/hr-invitations", { cookie: admin.cookie });
    expect(list.json.items[0]).toMatchObject({
      status: "used",
      usedByEmail: "hr1@example.com",
      note: "示例科技 招聘",
    });
  });

  it("已有账号接受邀请后升为 hr，并发只有一个人成功", async () => {
    await boot();
    const admin = await signup("boss@example.com");
    const a = await signup("a@example.com");
    const b = await signup("b@example.com");
    const created = await invite(admin.cookie);
    const [ra, rb] = await Promise.all([
      post("/api/v1/auth/invitations/accept", { token: created.token }, { cookie: a.cookie }),
      post("/api/v1/auth/invitations/accept", { token: created.token }, { cookie: b.cookie }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 400]);
    const roles = await handle.db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(sql`email in ('a@example.com','b@example.com')`);
    expect(roles.filter((r) => r.role === "hr")).toHaveLength(1);
    const winner = ra.status === 200 ? a : b;
    expect((await call("/api/v1/hr/jobs", { cookie: winner.cookie })).status).toBe(200);
  });

  it("过期、撤销后不可用；绑定邮箱的邀请只有该邮箱能用", async () => {
    await boot();
    const admin = await signup("boss@example.com");
    const expired = await invite(admin.cookie, { ttlHours: 1 });
    await handle.db.execute(
      sql`update auth_hr_invitations set expires_at = now() - interval '1 minute' where id = ${expired.id}`,
    );
    expect((await call(`/api/v1/auth/invitations/peek?token=${expired.token}`)).status).toBe(400);
    const u = await signup("u@example.com");
    expect(
      (await post("/api/v1/auth/invitations/accept", { token: expired.token }, { cookie: u.cookie })).status,
    ).toBe(400);

    const revoked = await invite(admin.cookie);
    expect(
      (await post(`/api/v1/admin/hr-invitations/${revoked.id}/revoke`, {}, { cookie: admin.cookie })).status,
    ).toBe(200);
    expect(
      (await post("/api/v1/auth/invitations/accept", { token: revoked.token }, { cookie: u.cookie })).status,
    ).toBe(400);

    const bound = await invite(admin.cookie, { email: "target@example.com" });
    expect(
      (await post("/api/v1/auth/invitations/accept", { token: bound.token }, { cookie: u.cookie })).status,
    ).toBe(400);
    const target = await signup("target@example.com");
    expect(
      (await post("/api/v1/auth/invitations/accept", { token: bound.token }, { cookie: target.cookie }))
        .status,
    ).toBe(200);

    const list = await call("/api/v1/admin/hr-invitations", { cookie: admin.cookie });
    expect(list.json.items.map((i: { status: string }) => i.status).sort()).toEqual([
      "expired",
      "revoked",
      "used",
    ]);
    expect(
      (await post(`/api/v1/admin/hr-invitations/${bound.id}/revoke`, {}, { cookie: admin.cookie })).status,
    ).toBe(409);
  });
});

describe("注销账号", () => {
  it("需要密码和邮箱确认，注销后所有数据被清掉、无法登录", async () => {
    await boot();
    const me = await signup("liming@example.com");
    const other = await signup("keep@example.com");
    const conv = await post("/api/v1/conversations", {}, { cookie: me.cookie });
    await post("/api/v1/conversations", {}, { cookie: other.cookie });
    await handle.db.insert(schema.profiles).values({ userId: me.id, data: {} as never });
    await handle.db
      .insert(schema.notifications)
      .values({ userId: me.id, kind: "x", title: "t", refId: "r" } as never);
    await handle.db.insert(schema.jobs).values({
      id: `user_import:${me.id}:abc`,
      source: "user_import",
      sourceJobId: `${me.id}:abc`,
      company: "示例科技",
      title: "导入的岗位",
      jdText: "jd",
      fetchedAt: new Date(),
    });

    const url = "/api/v1/auth/delete-account";
    expect(
      (
        await post(
          url,
          { password: "wrong-password", confirmation: "liming@example.com" },
          { cookie: me.cookie },
        )
      ).status,
    ).toBe(403);
    expect(
      (await post(url, { password: PASSWORD, confirmation: "other@example.com" }, { cookie: me.cookie }))
        .status,
    ).toBe(400);
    const done = await post(
      url,
      { password: PASSWORD, confirmation: "liming@example.com" },
      { cookie: me.cookie },
    );
    expect(done.status).toBe(200);
    expect(done.setCookie).toMatch(/Max-Age=0/);

    const count = async (table: string, col = "user_id") =>
      Number(
        (
          (await handle.db.execute(
            sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(col)} = ${me.id}`,
          )) as unknown as { rows: { n: number }[] }
        ).rows[0]?.n,
      );
    for (const table of ["conversations", "profiles", "notifications", "auth_sessions", "auth_tokens"])
      expect(await count(table)).toBe(0);
    expect(await handle.db.select().from(schema.users).where(eq(schema.users.id, me.id))).toHaveLength(0);
    expect(
      await handle.db
        .select()
        .from(schema.jobs)
        .where(sql`source_job_id like ${`${me.id}:%`}`),
    ).toHaveLength(0);
    expect((await login("liming@example.com")).status).toBe(401);
    expect((await call(`/api/v1/conversations/${conv.json.id}`, { cookie: me.cookie })).status).toBe(401);

    expect((await call("/api/v1/conversations", { cookie: other.cookie })).json.items).toHaveLength(1);
  });
});
