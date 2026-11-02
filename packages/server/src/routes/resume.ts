import { computeCompleteness } from "@talksume/agent";
import { profileToResume } from "@talksume/core";
import { schema } from "@talksume/db";
import { renderDocx, renderPdf } from "@talksume/resume-render";
import { asc, eq } from "drizzle-orm";
import type { RouteModule } from "../app.ts";
import { latestCompletedSections, loadProfile } from "../conversation-store.ts";
import { sendError } from "../http.ts";
import { polishedResume } from "../polish-store.ts";

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

export const resumeRoutes: RouteModule = (app, { db }) => {
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
    const { format } = req.query as { format?: string };
    if (format !== "pdf" && format !== "docx") {
      return sendError(reply, 400, "invalid_request", "format 必须是 pdf 或 docx");
    }
    const { profile } = await loadProfile(db, req.userId);
    const resume = await polishedResume(db, req.userId, profileToResume(profile));
    if (!resume.basics.name && resume.sections.length === 0) {
      return sendError(reply, 409, "profile_empty", "还没有可导出的内容，先和助手聊几句吧");
    }
    const target = FORMATS[format];
    try {
      const file = await target.render(resume);
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
