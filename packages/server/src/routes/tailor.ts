import type { FastifyReply } from "fastify";
import { z } from "zod";
import type { RouteModule } from "../app.ts";
import { sendError } from "../http.ts";
import {
  adoptTailoring,
  generateTailoring,
  listAdoptedTailorings,
  revokeTailoring,
  TailorError,
  tailoringView,
} from "../tailor-store.ts";

const AdoptBody = z.object({ changeIds: z.array(z.string()).min(1).max(100) });

const STATUS: Record<TailorError["code"], number> = {
  job_not_found: 404,
  not_found: 404,
  profile_empty: 409,
  no_changes: 400,
};

function failWith(reply: FastifyReply, error: unknown) {
  if (error instanceof TailorError) return sendError(reply, STATUS[error.code], error.code, error.message);
  throw error;
}

export const tailorRoutes: RouteModule = (app, { db, resumeLlm }) => {
  const llm = resumeLlm ?? null;
  const busy = new Set<string>();
  const jobIdOf = (params: unknown) => (params as { id: string }).id;

  app.get("/api/v1/tailorings", async (req) => ({ items: await listAdoptedTailorings(db, req.userId) }));

  app.get("/api/v1/jobs/:id/tailoring", async (req, reply) => {
    try {
      return { available: !!llm, ...(await tailoringView(db, req.userId, jobIdOf(req.params))) };
    } catch (error) {
      return failWith(reply, error);
    }
  });

  app.post("/api/v1/jobs/:id/tailoring", async (req, reply) => {
    if (!llm) return sendError(reply, 503, "llm_unavailable", "还没有配置模型，暂时不能定制");
    if (busy.has(req.userId)) return sendError(reply, 409, "tailor_busy", "上一次定制还没完成", true);
    const jobId = jobIdOf(req.params);
    busy.add(req.userId);
    try {
      await generateTailoring(db, llm, req.userId, jobId);
    } catch (error) {
      if (error instanceof TailorError) return failWith(reply, error);
      req.log.error({ err: error }, "resume tailor failed");
      return sendError(reply, 503, "tailor_failed", "定制暂时失败，请稍后重试", true);
    } finally {
      busy.delete(req.userId);
    }
    return { available: true, ...(await tailoringView(db, req.userId, jobId)) };
  });

  app.post("/api/v1/jobs/:id/tailoring/adopt", async (req, reply) => {
    const parsed = AdoptBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, "invalid_request", "请选择要采用的调整");
    const jobId = jobIdOf(req.params);
    try {
      const result = await adoptTailoring(db, req.userId, jobId, parsed.data.changeIds);
      return { ...result, available: !!llm, ...(await tailoringView(db, req.userId, jobId)) };
    } catch (error) {
      return failWith(reply, error);
    }
  });

  app.delete("/api/v1/jobs/:id/tailoring/adoption", async (req, reply) => {
    const jobId = jobIdOf(req.params);
    await revokeTailoring(db, req.userId, jobId);
    try {
      return { available: !!llm, ...(await tailoringView(db, req.userId, jobId)) };
    } catch (error) {
      return failWith(reply, error);
    }
  });
};
