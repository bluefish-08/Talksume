import { computeCompleteness } from "@talksume/agent";
import { profileToResume, type ResumeContent, ResumeStyle, resolveResumeStyle } from "@talksume/core";
import { schema } from "@talksume/db";
import { auditStyle, renderDocx, renderPdf, sampleResume } from "@talksume/resume-render";
import { and, eq } from "drizzle-orm";
import type { RouteModule } from "../app.ts";
import { latestCompletedSections, listFacts, loadProfile } from "../conversation-store.ts";
import { sendError } from "../http.ts";
import { polishedResume } from "../polish-store.ts";
import { loadResumeStyle, saveResumeStyle } from "../resume-style.ts";
import {
  applyResumeStyleDesign,
  currentStyleDesignId,
  deleteResumeStyleDesign,
  isCustomStyle,
  listResumeStyleDesigns,
  recordResumeStyleDesign,
} from "../style-designs.ts";

const FORMATS = {
  pdf: { mime: "application/pdf", render: renderPdf },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    render: renderDocx,
  },
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const { profile, version, updatedAt } = await loadProfile(db, req.userId);
    return {
      resume: await polishedResume(db, req.userId, profileToResume(profile)),
      profileVersion: version,
      updatedAt: updatedAt?.toISOString() ?? null,
    };
  });

  app.get("/api/v1/resume/style", async (req) => ({ style: await loadResumeStyle(db, req.userId) }));

  app.get("/api/v1/resume/style/designs", async (req) => {
    const designs = await listResumeStyleDesigns(db, req.userId);
    return {
      designs: designs.map(({ id, name, style, createdAt }) => ({ id, name, style, createdAt })),
      currentId: await currentStyleDesignId(db, req.userId, designs),
    };
  });

  app.post("/api/v1/resume/style/designs/:id/apply", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return sendError(reply, 404, "style_design_not_found", "这份设计不存在或已删除");
    const style = await applyResumeStyleDesign(db, req.userId, id);
    if (!style) return sendError(reply, 404, "style_design_not_found", "这份设计不存在或已删除");
    return { style };
  });

  app.delete("/api/v1/resume/style/designs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return sendError(reply, 404, "style_design_not_found", "这份设计不存在或已删除");
    const result = await deleteResumeStyleDesign(db, req.userId, id);
    if (result === "current") {
      return sendError(reply, 409, "style_design_in_use", "正在使用的设计不能删，先换一个再删");
    }
    if (result === "not_found") {
      return sendError(reply, 404, "style_design_not_found", "这份设计不存在或已删除");
    }
    return reply.code(204).send();
  });

  app.put("/api/v1/resume/style", async (req, reply) => {
    const parsed = ResumeStyle.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, "invalid_request", "模板、强调色或定制样式不合法");
    const style = resolveResumeStyle(parsed.data);
    if (style.css) {
      const { profile } = await loadProfile(db, req.userId);
      const mine = profileToResume(profile);
      const audited = await auditStyle(mine.sections.length === 0 ? sampleResume : mine, style);
      if (!audited.ok) return sendError(reply, 400, "invalid_style", audited.problems.join("；"));
    }
    if (!(await saveResumeStyle(db, req.userId, style))) {
      return sendError(reply, 404, "user_not_found", "用户不存在");
    }
    if (isCustomStyle(style)) {
      try {
        await recordResumeStyleDesign(db, req.userId, style, "chat");
      } catch (error) {
        req.log.warn({ err: error }, "resume style design record failed");
      }
    }
    return { style };
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
    const rows = await listFacts(db, req.userId);
    return {
      items: rows.map((r) => ({
        id: r.id,
        section: r.section,
        quote: r.quote,
        sourceMessageId: r.sourceMessageId,
        source: r.source,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.get("/api/v1/resume/export", async (req, reply) => {
    const { format, template, accent, version } = req.query as Record<string, string | undefined>;
    if (format !== "pdf" && format !== "docx") {
      return sendError(reply, 400, "invalid_request", "format 必须是 pdf 或 docx");
    }
    let resume: ResumeContent;
    if (version) {
      const [row] = UUID.test(version)
        ? await db
            .select({ content: schema.resumeVersions.content })
            .from(schema.resumeVersions)
            .where(and(eq(schema.resumeVersions.id, version), eq(schema.resumeVersions.userId, req.userId)))
        : [];
      if (!row) return sendError(reply, 404, "resume_not_found", "简历版本不存在");
      resume = row.content;
    } else {
      const { profile } = await loadProfile(db, req.userId);
      resume = await polishedResume(db, req.userId, profileToResume(profile));
    }
    if (!resume.basics.name && resume.sections.length === 0) {
      return sendError(reply, 409, "profile_empty", "还没有可导出的内容，先和助手聊几句吧");
    }
    const saved = await loadResumeStyle(db, req.userId);
    // 显式指定预设时按预设导出，否则用保存的样式（含对话定制的主题）
    const style =
      template || accent
        ? resolveResumeStyle({ template: template ?? saved.template, accent: accent ?? saved.accent })
        : saved;
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
