import { z } from "zod";
import type { RouteModule } from "../app.ts";
import { isUuid } from "../conversation-store.ts";
import { renameConversation } from "../conversation-title.ts";
import { sendError } from "../http.ts";

const RenameBody = z.object({
  title: z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(40)),
});

export const conversationTitleRoutes: RouteModule = (app, { db }) => {
  app.patch("/api/v1/conversations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = RenameBody.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "invalid_request", "标题不能为空且不超过 40 字");
    const row = isUuid(id) ? await renameConversation(db, req.userId, id, body.data.title) : undefined;
    if (!row) return sendError(reply, 404, "conversation_not_found", "会话不存在");
    return row;
  });
};
