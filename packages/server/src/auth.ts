import { type Db, schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

const DEMO_EMAIL = "demo@talksume.local";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 正式登录上线前的占位：带 x-talksume-user 头就用它，否则落到演示用户
export function registerDevAuth(app: FastifyInstance, db: Db): void {
  let demoUserId: Promise<string> | undefined;
  const demoUser = () => {
    demoUserId ??= (async () => {
      await db
        .insert(schema.users)
        .values({ email: DEMO_EMAIL, displayName: "演示用户" })
        .onConflictDoNothing();
      const [row] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, DEMO_EMAIL));
      if (!row) throw new Error("demo user missing");
      return row.id;
    })().catch((err: unknown) => {
      demoUserId = undefined;
      throw err;
    });
    return demoUserId;
  };

  app.decorateRequest("userId", "");
  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/v1/") || req.url === "/api/v1/meta") return;
    const header = req.headers["x-talksume-user"];
    req.userId = typeof header === "string" && UUID.test(header) ? header : await demoUser();
  });
}
