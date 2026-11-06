import type { FastifyReply } from "fastify";
import { z } from "zod";
import type { RouteModule } from "../app.ts";
import { sendError } from "../http.ts";
import {
  answerSession,
  beginSession,
  finishSession,
  generatePrep,
  getSession,
  InterviewError,
  prepView,
} from "../interview-store.ts";

const AnswerBody = z.object({ text: z.string().trim().min(1).max(4000) });

const STATUS: Record<InterviewError["code"], number> = {
  job_not_found: 404,
  not_found: 404,
  profile_empty: 409,
  no_prep: 409,
  finished: 409,
};

function failWith(reply: FastifyReply, error: unknown) {
  if (error instanceof InterviewError) return sendError(reply, STATUS[error.code], error.code, error.message);
  throw error;
}

export const interviewRoutes: RouteModule = (app, { db, resumeLlm }) => {
  const llm = resumeLlm ?? null;
  const busy = new Set<string>();
  const idOf = (params: unknown) => (params as { id: string }).id;

  async function exclusive<T>(userId: string, reply: FastifyReply, work: () => Promise<T>) {
    if (!llm) return sendError(reply, 503, "llm_unavailable", "还没有配置模型，暂时不能准备面试");
    if (busy.has(userId)) return sendError(reply, 409, "interview_busy", "上一次请求还没完成", true);
    busy.add(userId);
    try {
      return await work();
    } catch (error) {
      if (error instanceof InterviewError) return failWith(reply, error);
      app.log.error({ err: error }, "interview request failed");
      return sendError(reply, 503, "interview_failed", "面试准备暂时失败，请稍后重试", true);
    } finally {
      busy.delete(userId);
    }
  }

  app.get("/api/v1/jobs/:id/interview-prep", async (req, reply) => {
    try {
      return { available: !!llm, ...(await prepView(db, req.userId, idOf(req.params))) };
    } catch (error) {
      return failWith(reply, error);
    }
  });

  app.post("/api/v1/jobs/:id/interview-prep", async (req, reply) => {
    const jobId = idOf(req.params);
    return exclusive(req.userId, reply, async () => {
      if (!llm) throw new Error("unreachable");
      await generatePrep(db, llm, req.userId, jobId);
      return { available: true, ...(await prepView(db, req.userId, jobId)) };
    });
  });

  app.post("/api/v1/jobs/:id/interview-sessions", async (req, reply) => {
    try {
      return reply.code(201).send(await beginSession(db, req.userId, idOf(req.params)));
    } catch (error) {
      return failWith(reply, error);
    }
  });

  app.get("/api/v1/interview-sessions/:id", async (req, reply) => {
    try {
      return await getSession(db, req.userId, idOf(req.params));
    } catch (error) {
      return failWith(reply, error);
    }
  });

  app.post("/api/v1/interview-sessions/:id/answer", async (req, reply) => {
    const parsed = AnswerBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, "invalid_request", "回答不能为空，也不要超过 4000 字");
    const sessionId = idOf(req.params);
    return exclusive(req.userId, reply, () => {
      if (!llm) throw new Error("unreachable");
      return answerSession(db, llm, req.userId, sessionId, parsed.data.text);
    });
  });

  app.post("/api/v1/interview-sessions/:id/finish", async (req, reply) => {
    const sessionId = idOf(req.params);
    return exclusive(req.userId, reply, () => {
      if (!llm) throw new Error("unreachable");
      return finishSession(db, llm, req.userId, sessionId);
    });
  });
};
