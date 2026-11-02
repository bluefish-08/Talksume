import { computeCompleteness } from "@talksume/agent";
import { profileToResume, ResumeStyle, resolveResumeStyle } from "@talksume/core";
import { schema } from "@talksume/db";
import { renderDocx, renderPdf } from "@talksume/resume-render";
import { asc, eq } from "drizzle-orm";
import type { RouteModule } from "../app.ts";
import { latestCompletedSections, loadProfile } from "../conversation-store.ts";
import { sendError } from "../http.ts";
import { polishedResume } from "../polish-store.ts";
import { loadResumeStyle } from "../resume-style.ts";

const FORMATS = {
  pdf: { mime: "application/pdf", render: renderPdf },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    render: renderDocx,
  },
} as const;

/** ASCII 兜底名 + RFC 5987 的 UTF-8 名，中文文件名在各浏览器都不乱码。 */
function contentDisposition(name: string, format: string): string {
  const safe = name.replace(/[\\/:*?"<>|\p{Cc}]/gu, "").trim();
  const filename = `${safe ? `${safe}-` : ""}简历.${format}`;
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
  return `attachment; filename="resume.${format}"; filename*=UTF-8''${encoded}`;
}

export const resumeRoutes: RouteModule = (app, { db, templateAdvisor }) => {
  app.get("/api/v1/profile", async (req) => {
    const { profile, version } = await loadProfile(db, req.userId);
    const completedSections = await latestCompletedSections(db, req.userId);
    return { profile, version, completeness: computeCompleteness(profile, { completedSections }) };
  });

  app.get("/api/v1/resume", async (req) => {
    const { profile, version } = await loadProfile(db, req.userId);
    return {
      resume: await polishedResume(db, req.userId, profileToResume(profile)),
      profileVersion: version,
    };
  });

  app.get("/api/v1/resume/style", async (req) => ({ style: await loadResumeStyle(db, req.userId) }));

  app.put("/api/v1/resume/style", async (req, reply) => {
    const parsed = ResumeStyle.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, "invalid_request", "模板或强调色不在可选范围内");
    const updated = await db
      .update(schema.users)
      .set({ resumeStyle: parsed.data })
      .where(eq(schema.users.id, req.userId))
      .returning({ id: schema.users.id });
    if (updated.length === 0) return sendError(reply, 404, "user_not_found", "用户不存在");
    return { style: parsed.data };
  });

  app.post("/api/v1/resume/style/recommend", async (req, reply) => {
    if (!templateAdvisor) return sendError(reply, 503, "llm_unavailable", "模型服务未配置", true);
    const { profile } = await loadProfile(db, req.userId);
    const { education, experiences, projects, skills, intention } = profile;
    if (
      education.length + experiences.length + projects.length + skills.length + intention.roles.length ===
      0
    ) {
      return sendError(reply, 409, "profile_empty", "先和助手聊聊求职方向和经历，再来智能推荐");
    }
    try {
      return { recommendation: await templateAdvisor(profile) };
    } catch (error) {
      req.log.warn({ err: error }, "template recommend failed");
      return sendError(reply, 503, "recommend_failed", "智能推荐暂时不可用，请稍后再试", true);
    }
  });

  app.get("/api/v1/facts", async (req) => {
    const { profileFacts } = schema;
    const rows = await db
      .select()
      .from(profileFacts)
      .where(eq(profileFacts.userId, req.userId))
      .orderBy(asc(profileFacts.createdAt));
    return {
      items: rows.map((r) => ({
        id: r.id,
        section: r.section,
        quote: r.quote,
        sourceMessageId: r.sourceMessageId,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.get("/api/v1/resume/export", async (req, reply) => {
    const { format, template, accent } = req.query as Record<string, string | undefined>;
    if (format !== "pdf" && format !== "docx") {
      return sendError(reply, 400, "invalid_request", "format 必须是 pdf 或 docx");
    }
    const { profile } = await loadProfile(db, req.userId);
    const resume = await polishedResume(db, req.userId, profileToResume(profile));
    if (!resume.basics.name && resume.sections.length === 0) {
      return sendError(reply, 409, "profile_empty", "还没有可导出的内容，先和助手聊几句吧");
    }
    const saved = await loadResumeStyle(db, req.userId);
    const style = resolveResumeStyle({
      template: template ?? saved.template,
      accent: accent ?? saved.accent,
    });
    const target = FORMATS[format];
    try {
      const file = await target.render(resume, style);
      return reply
        .header("Content-Type", target.mime)
        .header("Content-Disposition", contentDisposition(resume.basics.name, format))
        .header("Cache-Control", "no-store")
        .send(Buffer.from(file));
    } catch (error) {
      req.log.error({ err: error }, "resume export failed");
      return sendError(reply, 503, "render_unavailable", "简历渲染服务暂不可用，请稍后重试", true);
    }
  });
};
