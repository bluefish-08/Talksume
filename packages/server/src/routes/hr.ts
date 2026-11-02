import { APPLICATION_STATUSES } from "@talksume/core";
import { ConcurrentTransitionError, schema } from "@talksume/db";
import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FlowContext } from "../flow/context.ts";
import { HttpError, parse, parseId } from "../flow/http.ts";
import { applicationColumns, loadTimeline, move } from "../flow/service.ts";

const { applications, jobs, resumeVersions, users } = schema;

const JobBody = z.object({
  title: z.string().min(1).max(200),
  company: z.string().min(1).max(200),
  cities: z.array(z.string().min(1)).max(20).default([]),
  jobType: z.enum(["internship", "campus", "experienced"]).optional(),
  salaryMin: z.number().int().nonnegative().optional(),
  salaryMax: z.number().int().nonnegative().optional(),
  degree: z.enum(["any", "associate", "bachelor", "master", "phd"]).optional(),
  jdText: z.string().min(1).max(20000),
  tags: z.array(z.string().min(1)).max(30).default([]),
  url: z.url().optional(),
});

const StatusBody = z
  .object({
    to: z.enum(APPLICATION_STATUSES),
    outcome: z.enum(["offer", "rejected"]).optional(),
    note: z.string().max(500).optional(),
    interviewAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((b) => (b.to === "closed") === (b.outcome !== undefined), {
    message: "只有 to=closed 时需要且必须给出 outcome（offer | rejected）",
  });

const ListQuery = z.object({
  jobId: z.string().min(1).optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
});

export function registerHrRoutes(app: FastifyInstance, ctx: FlowContext): void {
  const requireHr = async (req: { userId: string }) => {
    const [user] = await ctx.db.select({ role: users.role }).from(users).where(eq(users.id, req.userId));
    if (user?.role !== "hr") throw new HttpError(403, "forbidden", "需要 HR 身份");
  };

  const hrSelect = {
    application: applicationColumns,
    job: { id: jobs.id, title: jobs.title, company: jobs.company, ownerId: jobs.ownerId },
    candidate: { id: users.id, displayName: users.displayName, email: users.email },
    resume: {
      id: resumeVersions.id,
      template: resumeVersions.template,
      accent: resumeVersions.accent,
      content: resumeVersions.content,
      createdAt: resumeVersions.createdAt,
    },
  };

  const hrBase = () =>
    ctx.db
      .select(hrSelect)
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(users, eq(users.id, applications.userId))
      .leftJoin(resumeVersions, eq(resumeVersions.id, applications.resumeVersionId));

  const view = ({
    job: { ownerId: _owner, ...job },
    ...rest
  }: Awaited<ReturnType<typeof hrBase>>[number]) => ({
    ...rest,
    job,
  });

  async function loadOwned(hrId: string, id: string) {
    const [row] = await hrBase().where(eq(applications.id, id));
    if (!row) throw new HttpError(404, "not_found", "投递不存在");
    if (row.job.ownerId !== hrId) throw new HttpError(403, "forbidden", "只能处理自己发布职位的投递");
    return row;
  }

  app.register(async (hr) => {
    hr.addHook("preHandler", requireHr);

    hr.post("/api/v1/hr/jobs", async (req, reply) => {
      const body = parse(JobBody, req.body);
      const now = new Date();
      const sourceJobId = crypto.randomUUID();
      const [row] = await ctx.db
        .insert(jobs)
        .values({
          source: "hr_workspace",
          sourceJobId,
          ownerId: req.userId,
          company: body.company,
          title: body.title,
          cities: body.cities,
          jobType: body.jobType ?? null,
          salaryMin: body.salaryMin ?? null,
          salaryMax: body.salaryMax ?? null,
          degree: body.degree ?? null,
          jdText: body.jdText,
          url: body.url ?? null,
          tags: body.tags,
          postedAt: now,
          fetchedAt: now,
        })
        .returning();
      return reply.status(201).send({ job: row });
    });

    hr.get("/api/v1/hr/jobs", async (req) => {
      const rows = await ctx.db
        .select()
        .from(jobs)
        .where(eq(jobs.ownerId, req.userId))
        .orderBy(desc(jobs.postedAt));
      const counts =
        rows.length === 0
          ? []
          : await ctx.db
              .select({ jobId: applications.jobId, status: applications.status, n: count() })
              .from(applications)
              .where(
                inArray(
                  applications.jobId,
                  rows.map((r) => r.id),
                ),
              )
              .groupBy(applications.jobId, applications.status);
      return {
        items: rows.map(({ embedding: _embedding, ...job }) => {
          const mine = counts.filter((c) => c.jobId === job.id);
          return {
            ...job,
            applicationCount: mine.reduce((sum, c) => sum + c.n, 0),
            byStatus: Object.fromEntries(mine.map((c) => [c.status, c.n])),
          };
        }),
      };
    });

    hr.get("/api/v1/hr/applications", async (req) => {
      const query = parse(ListQuery, req.query);
      const filters: SQL[] = [eq(jobs.ownerId, req.userId)];
      if (query.jobId) filters.push(eq(jobs.id, query.jobId));
      if (query.status) filters.push(eq(applications.status, query.status));
      const rows = await hrBase()
        .where(and(...filters))
        .orderBy(desc(applications.createdAt));
      return { items: rows.map(view) };
    });

    // 打开详情即视为 HR 已查看
    hr.get("/api/v1/hr/applications/:id", async (req) => {
      const id = parseId((req.params as { id: string }).id);
      let row = await loadOwned(req.userId, id);
      if (row.application.status === "applied") {
        await move(ctx, id, "viewed", "hr", undefined, { expectedFrom: "applied" }).catch((err: unknown) => {
          if (!(err instanceof ConcurrentTransitionError)) throw err;
        });
        row = await loadOwned(req.userId, id);
      }
      return { ...view(row), timeline: await loadTimeline(ctx, id) };
    });

    hr.post("/api/v1/hr/applications/:id/status", async (req) => {
      const id = parseId((req.params as { id: string }).id);
      const body = parse(StatusBody, req.body);
      await loadOwned(req.userId, id);
      const payload = {
        ...(body.note && { note: body.note }),
        ...(body.interviewAt && { interviewAt: body.interviewAt }),
      };
      await move(ctx, id, body.to, "hr", body.outcome, { payload });
      const row = await loadOwned(req.userId, id);
      return { ...view(row), timeline: await loadTimeline(ctx, id) };
    });
  });
}
