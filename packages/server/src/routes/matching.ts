import { createGateway, GatewayConfigError, loadGatewayConfig } from "@talksume/llm-gateway";
import {
  createEmbedderFromEnv,
  createMatchingService,
  MatchingError,
  type MatchingServiceOptions,
} from "@talksume/matching";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import type { RouteModule } from "../app.ts";

const JobTypeParam = z.enum(["internship", "campus", "experienced"]);

const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  city: z.string().trim().max(30).optional(),
  jobType: JobTypeParam.optional(),
  company: z.string().trim().max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const MatchesQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const RefreshBody = z.object({ wait: z.boolean().optional() }).default({});
const FeedbackBody = z.object({
  signal: z.enum(["like", "dislike", "irrelevant"]),
  reason: z.string().trim().max(500).optional(),
});
const ImportBody = z.object({
  text: z.string().trim().min(20, "JD 文本太短").max(20000),
  url: z.url().optional(),
});

function llmFromEnv() {
  try {
    return createGateway(loadGatewayConfig());
  } catch (error) {
    if (error instanceof GatewayConfigError) return null;
    throw error;
  }
}

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

/** 传 llm / embedder 为 null 可显式关闭；不传则按环境变量决定。 */
export function createMatchingRoutes(options: MatchingServiceOptions = {}): RouteModule {
  return (root, deps) => {
    // 错误处理器只作用于本模块，不影响其他路由模块
    root.register(async (app) => {
      const service = createMatchingService(deps.db, {
        llm: options.llm === undefined ? llmFromEnv() : options.llm,
        embedder: options.embedder === undefined ? (createEmbedderFromEnv() ?? null) : options.embedder,
        onError: (message, error) => app.log.warn({ err: error }, message),
        ...options,
      });

      app.setErrorHandler((error, req, reply) => {
        if (error instanceof MatchingError) return fail(reply, error.status, error.code, error.message);
        if (error instanceof z.ZodError) {
          return fail(reply, 400, "bad_request", error.issues.map((i) => i.message).join("；"));
        }
        req.log.error({ err: error }, "unhandled error");
        const status = (error as { statusCode?: number }).statusCode ?? 500;
        return fail(
          reply,
          status,
          status === 500 ? "internal_error" : "bad_request",
          status === 500 ? "服务器内部错误" : (error as Error).message,
        );
      });

      app.get("/api/v1/jobs", async (req) => {
        const query = ListQuery.parse(req.query);
        const { items, total } = await service.searchJobs(req.userId, {
          ...(query.q && { q: query.q }),
          ...(query.city && { city: query.city }),
          ...(query.jobType && { jobType: query.jobType }),
          ...(query.company && { company: query.company }),
          page: query.page,
          pageSize: query.pageSize,
        });
        return { items, total, page: query.page, pageSize: query.pageSize };
      });

      app.post("/api/v1/jobs/import", async (req, reply) => {
        const body = ImportBody.parse(req.body);
        const result = await service.importJob(req.userId, {
          text: body.text,
          ...(body.url && { url: body.url }),
        });
        return reply.code(201).send(result);
      });

      app.get<{ Params: { id: string } }>("/api/v1/jobs/:id", async (req, reply) => {
        const job = await service.getJob(req.userId, req.params.id);
        return job ?? fail(reply, 404, "job_not_found", "岗位不存在");
      });

      app.post<{ Params: { id: string } }>("/api/v1/jobs/:id/feedback", async (req, reply) => {
        const body = FeedbackBody.parse(req.body);
        const saved = await service.recordFeedback(req.userId, req.params.id, body.signal, body.reason);
        return reply.code(201).send(saved);
      });

      app.post("/api/v1/matches/refresh", async (req) => {
        const body = RefreshBody.parse(req.body ?? {});
        const { done, rerank, ...result } = await service.refresh(req.userId);
        if (body.wait) await done;
        return { ...result, rerank: body.wait && rerank === "pending" ? "done" : rerank };
      });

      app.post<{ Params: { id: string } }>("/api/v1/jobs/:id/report", async (req, reply) => {
        const body = RefreshBody.parse(req.body ?? {});
        const { reportStatus, done } = await service.retryReport(req.userId, req.params.id);
        if (body.wait) await done;
        const status = body.wait && reportStatus === "pending" ? "done" : reportStatus;
        return reply.code(202).send({ jobId: req.params.id, reportStatus: status });
      });

      app.get("/api/v1/matches", async (req) => {
        const { limit } = MatchesQuery.parse(req.query);
        return service.listMatches(req.userId, limit);
      });
    });
  };
}

export const matchingRoutes: RouteModule = (app, deps) => createMatchingRoutes()(app, deps);
