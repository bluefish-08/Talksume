import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { devHeaderIdentity, type IdentityProvider, localUserIdentity, requireRole } from "./identity.ts";

let handle: DbHandle;

beforeEach(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
});

afterEach(async () => {
  await handle.close();
});

const boot = async (identity?: IdentityProvider, edition: "local" | "cloud" = "local") => {
  const app = buildApp({ edition, version: "t", db: handle.db, ...(identity && { identity }) });
  await app.ready();
  return app;
};

const insertUser = async (email: string, role: "seeker" | "hr" | "admin" = "seeker") => {
  const [row] = await handle.db
    .insert(schema.users)
    .values({ email, role })
    .returning({ id: schema.users.id });
  return row?.id ?? "";
};

describe("本地单用户身份", () => {
  it("不登录，所有请求都是同一个本机用户，x-talksume-user 头无效", async () => {
    const app = await boot(localUserIdentity(handle.db));
    const victim = await insertUser("victim@example.com");
    const a = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    const b = await app.inject({
      method: "POST",
      url: "/api/v1/conversations",
      headers: { "x-talksume-user": victim },
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    const rows = await handle.db.select({ userId: schema.conversations.userId }).from(schema.conversations);
    expect(new Set(rows.map((r) => r.userId)).size).toBe(1);
    expect(rows[0]?.userId).not.toBe(victim);
    await app.close();
  });

  it("本机用户不是 HR，HR 接口 403", async () => {
    const app = await boot(localUserIdentity(handle.db));
    expect((await app.inject({ method: "GET", url: "/api/v1/hr/jobs" })).statusCode).toBe(403);
    await app.close();
  });
});

describe("开发身份", () => {
  it("按头指定用户，缺省落到演示用户", async () => {
    const app = await boot(devHeaderIdentity(handle.db));
    const id = await insertUser("someone@example.com");
    await app.inject({ method: "POST", url: "/api/v1/conversations", headers: { "x-talksume-user": id } });
    await app.inject({ method: "POST", url: "/api/v1/conversations" });
    const mine = await handle.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.userId, id));
    expect(mine).toHaveLength(1);
    const [demo] = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "demo@talksume.local"));
    expect(demo).toBeDefined();
    await app.close();
  });

  it("生产环境直接拒绝创建", () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => devHeaderIdentity(handle.db)).toThrow(/生产环境/);
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});

describe("注入身份", () => {
  const fixed = (userId: string | null, role: "seeker" | "hr" | "admin" = "seeker"): IdentityProvider => ({
    async resolve() {
      return userId ? { userId, role } : null;
    },
    isPublic: (path) => path === "/api/v1/open",
  });

  it("拿不到身份就是 401，public 路径除外", async () => {
    const app = await boot(fixed(null));
    expect((await app.inject({ method: "GET", url: "/api/v1/conversations" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/meta" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/open" })).statusCode).toBe(404);
    await app.close();
  });

  it("cloud 版不注入身份会启动失败（除非显式开了开发身份）", () => {
    const saved = process.env.TALKSUME_DEV_AUTH;
    delete process.env.TALKSUME_DEV_AUTH;
    try {
      expect(() => buildApp({ edition: "cloud", version: "t", db: handle.db })).toThrow(/identity/);
    } finally {
      if (saved !== undefined) process.env.TALKSUME_DEV_AUTH = saved;
    }
  });

  it("requireRole 按角色放行 HR 接口", async () => {
    const seeker = await insertUser("s@example.com");
    const hr = await insertUser("h@example.com", "hr");
    const admin = await insertUser("a@example.com", "admin");
    for (const [id, role, status] of [
      [seeker, "seeker", 403],
      [hr, "hr", 200],
      [admin, "admin", 200],
    ] as const) {
      const app = await boot(fixed(id, role));
      expect((await app.inject({ method: "GET", url: "/api/v1/hr/jobs" })).statusCode).toBe(status);
      await app.close();
    }
    expect(typeof requireRole("hr")).toBe("function");
  });
});
