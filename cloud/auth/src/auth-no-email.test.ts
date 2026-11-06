import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { buildApp } from "@talksume/server";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCloudIdentity } from "./identity.ts";
import { migrateCloudAuth } from "./index.ts";
import { MemoryMailer } from "./mailer.ts";
import { hashPassword } from "./password.ts";

const PASSWORD = "correct-horse-1";
const FAST_SCRYPT = { N: 2 ** 10, r: 8, p: 1 };

let handle: DbHandle;
let app: FastifyInstance;
let mailer: MemoryMailer;

// 邮件关闭、生产模式、没有 APP_URL 也没有 SMTP：默认配置下必须能启动
async function boot(options: Record<string, unknown> = {}) {
  mailer = new MemoryMailer();
  delete process.env.SMTP_HOST;
  app = buildApp({
    edition: "cloud",
    version: "t",
    db: handle.db,
    identity: createCloudIdentity(handle.db, {
      production: true,
      mailer,
      scrypt: FAST_SCRYPT,
      adminEmails: ["boss@example.com"],
      ...options,
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

const ORIGIN = "http://localhost";

async function call(
  url: string,
  {
    method = "GET",
    cookie,
    body,
    origin = ORIGIN,
  }: { method?: "GET" | "POST"; cookie?: string; body?: unknown; origin?: string | null } = {},
) {
  const res = await app.inject({
    method,
    url,
    headers: { ...(origin && { origin }), ...(cookie && { cookie }) },
    ...(body !== undefined && { payload: body as object }),
  });
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return {
    status: res.statusCode,
    // biome-ignore lint/suspicious/noExplicitAny: 各接口响应体形状不同
    json: (res.body ? res.json() : {}) as Record<string, any>,
    setCookie: first,
    cookie: first?.split(";")[0] ?? "",
  };
}

const post = (url: string, body: unknown, extra = {}) => call(url, { method: "POST", body, ...extra });
const register = (email: string, extra: Record<string, unknown> = {}) =>
  post("/api/v1/auth/register", { email, password: PASSWORD, ...extra });

describe("邮件功能关闭（默认）", () => {
  it("生产模式不配 SMTP、不配 APP_URL 也能启动，config 报告 emailEnabled=false", async () => {
    await boot();
    expect((await call("/api/v1/auth/config")).json).toEqual({ emailEnabled: false });
  });

  it("注册即视为已验证并直接登录，不发任何邮件，能直接用业务功能，退出后可再登录", async () => {
    await boot();
    const res = await register("liming@example.com", { displayName: "李明" });
    expect(res.status).toBe(201);
    expect(res.json.user).toMatchObject({ email: "liming@example.com", emailVerified: true, role: "seeker" });
    expect(res.setCookie).toMatch(/HttpOnly/);
    expect(res.setCookie).toMatch(/SameSite=Lax/);
    const [row] = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "liming@example.com"));
    expect(row?.emailVerifiedAt).toBeInstanceOf(Date);

    expect((await call("/api/v1/auth/me", { cookie: res.cookie })).status).toBe(200);
    expect((await post("/api/v1/conversations", {}, { cookie: res.cookie })).status).toBe(201);
    expect((await post("/api/v1/auth/logout", {}, { cookie: res.cookie })).status).toBe(200);
    expect((await call("/api/v1/conversations", { cookie: res.cookie })).status).toBe(401);

    const again = await post("/api/v1/auth/login", { email: "liming@example.com", password: PASSWORD });
    expect(again.status).toBe(200);
    expect((await call("/api/v1/conversations", { cookie: again.cookie })).status).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });

  it("重复邮箱明确提示已注册", async () => {
    await boot();
    await register("liming@example.com");
    const dup = await register("liming@example.com");
    expect(dup.status).toBe(409);
    expect(dup.json.error).toBe("email_taken");
    expect(dup.json.message).toContain("已注册");
    expect(dup.setCookie).toBeUndefined();
  });

  it("ADMIN_EMAILS 里的邮箱注册时直接成为管理员；之前开邮件留下的未验证账号登录时放行", async () => {
    await boot();
    const boss = await register("boss@example.com");
    expect(boss.json.user.role).toBe("admin");

    await handle.db
      .insert(schema.users)
      .values({ email: "old@example.com", passwordHash: await hashPassword(PASSWORD, FAST_SCRYPT) });
    const old = await post("/api/v1/auth/login", { email: "old@example.com", password: PASSWORD });
    expect(old.status).toBe(200);
    expect(old.json.user.emailVerified).toBe(true);
    expect((await call("/api/v1/conversations", { cookie: old.cookie })).status).toBe(200);
  });

  it("依赖邮件的接口返回明确错误，不发信", async () => {
    await boot();
    for (const [url, body] of [
      ["/api/v1/auth/forgot-password", { email: "liming@example.com" }],
      ["/api/v1/auth/resend-verification", { email: "liming@example.com" }],
      ["/api/v1/auth/verify-email", { token: "x".repeat(20) }],
      ["/api/v1/auth/reset-password", { token: "x".repeat(20), password: PASSWORD }],
    ] as const) {
      const res = await post(url, body);
      expect(res.status, url).toBe(400);
      expect(res.json.error).toBe("email_disabled");
    }
    expect(mailer.sent).toHaveLength(0);
  });

  it("没有 APP_URL 时 Origin 只放行同主机，其他来源 403；GET 不校验", async () => {
    await boot();
    expect((await register("a@example.com", {})).status).toBe(201);
    const evil = await post(
      "/api/v1/auth/login",
      { email: "a@example.com", password: PASSWORD },
      { origin: "https://evil.example.org" },
    );
    expect(evil.status).toBe(403);
    expect(
      (await post("/api/v1/auth/login", { email: "a@example.com", password: PASSWORD }, { origin: null }))
        .status,
    ).toBe(403);
    expect((await call("/api/v1/auth/config", { origin: "https://evil.example.org" })).status).toBe(200);
  });

  it("配了 APP_URL 就只认配置的来源", async () => {
    await boot({ appUrl: "https://talksume.example.com" });
    expect((await register("a@example.com")).status).toBe(403);
    expect(
      (
        await register("a@example.com", {}).then(() =>
          post(
            "/api/v1/auth/register",
            { email: "b@example.com", password: PASSWORD },
            { origin: "https://talksume.example.com" },
          ),
        )
      ).status,
    ).toBe(201);
  });

  it("HR 邀请不依赖邮件：链接用请求来源拼，带邀请注册后直接是 hr，只能用一次", async () => {
    await boot();
    const boss = await register("boss@example.com");
    const created = await post("/api/v1/admin/hr-invitations", { note: "示例科技" }, { cookie: boss.cookie });
    expect(created.status).toBe(201);
    expect(created.json.link).toMatch(/^http:\/\/localhost\/invite\?token=/);
    const token = new URL(created.json.link).searchParams.get("token");

    const hr = await register("hr@example.com", { invitationToken: token });
    expect(hr.status).toBe(201);
    expect(hr.json.user.role).toBe("hr");
    expect((await call("/api/v1/hr/jobs", { cookie: hr.cookie })).status).toBe(200);
    expect((await register("hr2@example.com", { invitationToken: token })).status).toBe(400);
  });
});

describe("管理员重置密码（两种模式都可用）", () => {
  for (const emailEnabled of [false, true]) {
    it(`emailEnabled=${emailEnabled}：生成临时密码，作废全部会话，写审计，只有 admin 能用`, async () => {
      await boot(emailEnabled ? { emailEnabled: true, appUrl: ORIGIN } : {});
      const signup = async (email: string) => {
        if (!emailEnabled) return (await register(email)).cookie;
        await register(email);
        const mail = mailer.last(email);
        const token = decodeURIComponent(mail?.text.match(/token=([^\s]+)/)?.[1] ?? "");
        await post("/api/v1/auth/verify-email", { token });
        return (await post("/api/v1/auth/login", { email, password: PASSWORD })).cookie;
      };
      const boss = await signup("boss@example.com");
      const user = await signup("liming@example.com");
      const other = (await post("/api/v1/auth/login", { email: "liming@example.com", password: PASSWORD }))
        .cookie;

      expect(
        (await post("/api/v1/admin/users/reset-password", { email: "boss@example.com" }, { cookie: user }))
          .status,
      ).toBe(403);
      expect(
        (await post("/api/v1/admin/users/reset-password", { email: "nobody@example.com" }, { cookie: boss }))
          .status,
      ).toBe(404);

      const reset = await post(
        "/api/v1/admin/users/reset-password",
        { email: "liming@example.com" },
        { cookie: boss },
      );
      expect(reset.status).toBe(200);
      const temp = reset.json.temporaryPassword as string;
      expect(temp.length).toBeGreaterThanOrEqual(16);

      expect((await call("/api/v1/auth/me", { cookie: user })).status).toBe(401);
      expect((await call("/api/v1/auth/me", { cookie: other })).status).toBe(401);
      expect(
        (await post("/api/v1/auth/login", { email: "liming@example.com", password: PASSWORD })).status,
      ).toBe(401);
      const login = await post("/api/v1/auth/login", { email: "liming@example.com", password: temp });
      expect(login.status).toBe(200);

      const audit = (
        (await handle.db.execute(sql`select action, target_email, ip from auth_audit_logs`)) as unknown as {
          rows: { action: string; target_email: string }[];
        }
      ).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "reset_password", target_email: "liming@example.com" });
    });
  }
});
