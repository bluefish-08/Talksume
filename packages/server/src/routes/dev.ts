import { schema } from "@talksume/db";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FlowContext } from "../flow/context.ts";
import { parse } from "../flow/http.ts";

const Body = z.object({
  email: z.email().default("hr-demo@talksume.local"),
  displayName: z.string().min(1).max(100).default("演示 HR"),
});

/** 登录上线前给联调用：创建或取回 HR 用户，返回的 userId 放进 x-talksume-user 头即可。 */
export function registerDevRoutes(app: FastifyInstance, ctx: FlowContext): void {
  app.post("/api/v1/dev/hr", async (req) => {
    const { email, displayName } = parse(Body, req.body);
    const [row] = await ctx.db
      .insert(schema.users)
      .values({ email, displayName, role: "hr" })
      .onConflictDoUpdate({ target: schema.users.email, set: { role: sql`'hr'` } })
      .returning({ id: schema.users.id, email: schema.users.email, displayName: schema.users.displayName });
    return { userId: row?.id, email: row?.email, displayName: row?.displayName, role: "hr" };
  });
}
