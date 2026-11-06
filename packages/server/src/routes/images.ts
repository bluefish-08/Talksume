import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.ts";
import { sendError } from "../http.ts";
import { deleteUserImage, loadUserImage, saveUserImage } from "../image-store.ts";
import { cleanImage, IMAGE_LIMITS, ImageError } from "../images.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** 对话里发的参考图：和简历导入分开，只为让助手看图，不进入画像。 */
export function imageRoutes(app: FastifyInstance, deps: AppDeps & { db: NonNullable<AppDeps["db"]> }) {
  const { db } = deps;

  app.addContentTypeParser([...IMAGE_TYPES], { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post("/api/v1/images", { bodyLimit: IMAGE_LIMITS.maxBytes + 64 * 1024 }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) {
      return sendError(reply, 415, "unsupported_type", "请直接上传 PNG、JPEG 或 WebP 图片");
    }
    try {
      const image = await saveUserImage(db, req.userId, cleanImage(req.body));
      return reply.code(201).send(image);
    } catch (error) {
      if (error instanceof ImageError) return sendError(reply, error.status, error.code, error.message);
      throw error;
    }
  });

  app.get("/api/v1/images/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = UUID.test(id) ? await loadUserImage(db, req.userId, id) : undefined;
    if (!row) return sendError(reply, 404, "image_not_found", "图片不存在");
    return reply
      .header("Content-Type", row.mimeType)
      .header("Cache-Control", "private, max-age=3600")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .send(row.data);
  });

  app.delete("/api/v1/images/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id) || !(await deleteUserImage(db, req.userId, id))) {
      return sendError(reply, 404, "image_not_found", "图片不存在");
    }
    return reply.code(204).send();
  });
}
