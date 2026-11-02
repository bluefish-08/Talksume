import type { ServerResponse } from "node:http";
import { schema } from "@talksume/db";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FlowContext } from "../flow/context.ts";
import { parse } from "../flow/http.ts";

const { notifications } = schema;

const ListQuery = z.object({
  unread: z.enum(["1", "true"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const ReadBody = z.object({ ids: z.array(z.string()).max(500).optional() });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerNotificationRoutes(app: FastifyInstance, ctx: FlowContext): void {
  const columns = {
    id: notifications.id,
    kind: notifications.kind,
    title: notifications.title,
    refId: notifications.refId,
    readAt: notifications.readAt,
    createdAt: notifications.createdAt,
  };

  const unreadCount = async (userId: string) => {
    const [row] = await ctx.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return row?.n ?? 0;
  };

  app.get("/api/v1/notifications", async (req) => {
    const query = parse(ListQuery, req.query);
    const filters = [eq(notifications.userId, req.userId)];
    if (query.unread) filters.push(isNull(notifications.readAt));
    const items = await ctx.db
      .select(columns)
      .from(notifications)
      .where(and(...filters))
      .orderBy(desc(notifications.createdAt))
      .limit(query.limit);
    return { items, unreadCount: await unreadCount(req.userId) };
  });

  app.post("/api/v1/notifications/read", async (req) => {
    const { ids } = parse(ReadBody, req.body);
    const filters = [eq(notifications.userId, req.userId), isNull(notifications.readAt)];
    if (ids)
      filters.push(
        inArray(
          notifications.id,
          ids.filter((id) => UUID.test(id)),
        ),
      );
    const updated = await ctx.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(...filters))
      .returning({ id: notifications.id });
    return { updated: updated.length, unreadCount: await unreadCount(req.userId) };
  });

  const streams = new Set<ServerResponse>();
  app.addHook("onClose", async () => {
    for (const res of streams) res.end();
  });

  app.get("/api/v1/notifications/stream", async (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 5000\n: connected\n\n");
    streams.add(res);

    let unsubscribe: (() => void) | undefined;
    const heartbeat = setInterval(() => res.write(": ping\n\n"), ctx.sseHeartbeatMs);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe?.();
      unsubscribe = undefined;
      streams.delete(res);
    };
    req.raw.on("close", cleanup);

    const stop = await ctx.notifier.subscribe(req.userId, (n) => {
      res.write(`id: ${n.id ?? ""}\nevent: notification\ndata: ${JSON.stringify(n)}\n\n`);
    });
    if (res.destroyed || res.writableEnded) stop();
    else unsubscribe = stop;
  });
}
