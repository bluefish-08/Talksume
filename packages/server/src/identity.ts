import { type Db, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface Identity {
  userId: string;
  role: schema.UserRole;
  email?: string;
  displayName?: string | null;
}

/** resolve 已经自己回复了请求（比如 Origin 校验失败、邮箱未验证）。 */
export const REPLIED = Symbol("replied");

/** 身份端口：本地版固定一个本机用户，云端版由 cloud 侧实现注册登录并注入。 */
export interface IdentityProvider {
  resolve(req: FastifyRequest, reply: FastifyReply): Promise<Identity | null | typeof REPLIED>;
  /** 不要求登录的接口，比如云端的登录、注册。 */
  isPublic?(path: string): boolean;
  /** 注册身份自己的路由（登录、注册等），在身份钩子之后调用。 */
  register?(app: FastifyInstance, deps: { db: Db }): void;
  /** 只给测试和联调：允许 /api/v1/dev/* 联调接口。 */
  readonly dev?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    identity: Identity | null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_EMAIL = "local@talksume.local";
const DEMO_EMAIL = "demo@talksume.local";

function cachedUser(db: Db, email: string, displayName: string): () => Promise<string> {
  let id: Promise<string> | undefined;
  return () => {
    id ??= (async () => {
      await db.insert(schema.users).values({ email, displayName }).onConflictDoNothing();
      const [row] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email));
      if (!row) throw new Error(`user ${email} missing`);
      return row.id;
    })().catch((err: unknown) => {
      id = undefined;
      throw err;
    });
    return id;
  };
}

/** 本地版默认：不登录，所有请求都是同一个本机用户。 */
export function localUserIdentity(db: Db): IdentityProvider {
  const user = cachedUser(db, LOCAL_EMAIL, "本机用户");
  return {
    async resolve() {
      return { userId: await user(), role: "seeker", email: LOCAL_EMAIL };
    },
  };
}

/** 只给测试和开发：x-talksume-user 头指定用户，缺省落到演示用户。生产环境禁止。 */
export function devHeaderIdentity(db: Db): IdentityProvider {
  if (process.env.NODE_ENV === "production") {
    throw new Error("生产环境不能使用 x-talksume-user 开发身份");
  }
  const demo = cachedUser(db, DEMO_EMAIL, "演示用户");
  return {
    dev: true,
    async resolve(req) {
      const header = req.headers["x-talksume-user"];
      const userId = typeof header === "string" && UUID.test(header) ? header : await demo();
      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      return {
        userId,
        role: row?.role ?? "seeker",
        email: row?.email ?? "",
        displayName: row?.displayName ?? null,
      };
    },
  };
}

export function installIdentity(app: FastifyInstance, provider: IdentityProvider, db?: Db): void {
  app.decorateRequest("userId", "");
  app.decorateRequest("identity", null);
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0] ?? "";
    if (!path.startsWith("/api/") || path === "/api/v1/meta") return;
    const resolved = await provider.resolve(req, reply);
    if (resolved === REPLIED) return reply;
    req.identity = resolved;
    req.userId = resolved?.userId ?? "";
    if (!resolved && !provider.isPublic?.(path)) {
      return reply.code(401).send({ error: "unauthenticated", message: "请先登录" });
    }
  });
  if (db) provider.register?.(app, { db });
}

/** 路由守卫：当前身份的角色不在列表里就 403。 */
export function requireRole(...roles: schema.UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.identity || !roles.includes(req.identity.role)) {
      return reply.code(403).send({ error: "forbidden", message: "没有权限访问" });
    }
  };
}
