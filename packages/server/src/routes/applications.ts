import { schema } from "@talksume/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FlowContext } from "../flow/context.ts";
import { HttpError, parse, parseId } from "../flow/http.ts";
import { createApplication, loadBoard, loadCandidateDetail, move } from "../flow/service.ts";

const CreateBody = z.object({
  jobId: z.string().min(1),
  resumeVersionId: z.string().min(1).optional(),
  pitch: z.string().max(2000).optional(),
});

const NoteBody = z.object({ note: z.string().max(500).optional() });

const BackfillBody = z
  .object({
    to: z.enum(["viewed", "interviewing", "closed"]),
    outcome: z.enum(["offer", "rejected"]).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((b) => (b.to === "closed") === (b.outcome !== undefined), {
    message: "只有 to=closed 时需要且必须给出 outcome",
  });

const payloadOf = (note: string | undefined) => (note ? { payload: { note } } : {});

export function registerApplicationRoutes(app: FastifyInstance, ctx: FlowContext): void {
  async function ownAssisted(userId: string, id: string) {
    const [row] = await ctx.db
      .select({ channel: schema.applications.channel })
      .from(schema.applications)
      .where(and(eq(schema.applications.id, id), eq(schema.applications.userId, userId)));
    if (!row) throw new HttpError(404, "not_found", "投递不存在");
    return row.channel === "assisted";
  }

  app.post("/api/v1/applications", async (req, reply) => {
    const body = parse(CreateBody, req.body);
    const { applicationId, submitError } = await createApplication(ctx, req.userId, body);
    const detail = await loadCandidateDetail(ctx, req.userId, applicationId);
    const manual = detail.application.status === "pending" && detail.application.channel === "assisted";
    return reply.status(201).send({
      ...detail,
      nextAction: manual ? "manual_apply" : null,
      ...(submitError && { submitError }),
    });
  });

  app.get("/api/v1/applications", async (req) => loadBoard(ctx, req.userId));

  app.get("/api/v1/applications/:id", async (req) => {
    const { id } = req.params as { id: string };
    return loadCandidateDetail(ctx, req.userId, parseId(id));
  });

  app.post("/api/v1/applications/:id/mark-applied", async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const { note } = parse(NoteBody, req.body);
    if (!(await ownAssisted(req.userId, id))) {
      throw new HttpError(409, "not_assisted", "该投递不是辅助投递，状态由平台或 HR 更新");
    }
    await move(ctx, id, "applied", "user", undefined, { expectedFrom: "pending", ...payloadOf(note) });
    return loadCandidateDetail(ctx, req.userId, id);
  });

  app.post("/api/v1/applications/:id/withdraw", async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const { note } = parse(NoteBody, req.body);
    await loadCandidateDetail(ctx, req.userId, id);
    await move(ctx, id, "closed", "user", "withdrawn", payloadOf(note));
    return loadCandidateDetail(ctx, req.userId, id);
  });

  // 辅助投递的状态由用户自己回填；内部与平台渠道由 HR / 平台推进
  app.post("/api/v1/applications/:id/status", async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const body = parse(BackfillBody, req.body);
    if (!(await ownAssisted(req.userId, id))) {
      throw new HttpError(403, "forbidden", "该投递的状态由平台或 HR 更新，不能手动修改");
    }
    await move(ctx, id, body.to, "user", body.outcome, payloadOf(body.note));
    return loadCandidateDetail(ctx, req.userId, id);
  });
}
