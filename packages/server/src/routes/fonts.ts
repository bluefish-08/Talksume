import { isFontName, type ResumeFontName } from "@talksume/core";
import { fontFaceCss, fontFile } from "@talksume/resume-render";
import type { FastifyInstance } from "fastify";
import { sendError } from "../http.ts";

const BASE = "/api/v1/resume-fonts/";
const CACHE = "public, max-age=604800, immutable";

/** 简历预览用的随包字体：只有 @font-face 样式表和 woff2 文件，文件名由随包字体表限定。 */
export function fontRoutes(app: FastifyInstance) {
  app.get("/api/v1/resume-fonts/faces.css", async (req, reply) => {
    const { f } = req.query as { f?: string };
    const names = [...new Set((f ?? "").split(",").filter(isFontName))] as ResumeFontName[];
    if (names.length === 0) return sendError(reply, 400, "invalid_request", "f 必须是内置字体名");
    return reply
      .header("Content-Type", "text/css; charset=utf-8")
      .header("Cache-Control", CACHE)
      .send(fontFaceCss(names, BASE));
  });

  app.get("/api/v1/resume-fonts/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    const body = fontFile(file);
    if (!body) return sendError(reply, 404, "font_not_found", "字体不存在");
    return reply
      .header("Content-Type", "font/woff2")
      .header("Cache-Control", CACHE)
      .header("X-Content-Type-Options", "nosniff")
      .send(body);
  });
}
