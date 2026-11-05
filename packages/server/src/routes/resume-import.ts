import { randomUUID } from "node:crypto";
import {
  applyFacts,
  applyImport,
  type Draft,
  type FactInput,
  groupImportFacts,
  importOpening,
  labelOfFact,
  RESUME_MESSAGE_PREFIX,
  verifyImportFacts,
} from "@talksume/agent";
import type { Profile } from "@talksume/core";
import { schema } from "@talksume/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import { summarizePrevious } from "../conversation-memory.ts";
import {
  createEmptyConversation,
  loadConversation,
  loadUserMemory,
  persistState,
} from "../conversation-store.ts";
import { sendError } from "../http.ts";
import {
  checkResumeText,
  DOCX_MIME,
  extractResumeText,
  fileKindOf,
  IMPORT_LIMITS,
  ImportError,
} from "../resume-import/extract.ts";
import { parseResumeWithLlm } from "../resume-import/llm.ts";

const IMPORT_TITLE = "导入简历";
const FILE_TYPES = ["application/pdf", DOCX_MIME, "application/msword", "application/octet-stream"] as const;

const PasteBody = z.object({ text: z.string().max(IMPORT_LIMITS.textChars * 2) });
const ConfirmBody = z.object({
  text: z
    .string()
    .min(1)
    .max(IMPORT_LIMITS.textChars * 2),
  fileName: z.string().max(200).optional(),
  facts: z.array(z.unknown()).min(1).max(300),
  conversationId: z.string().optional(),
});

type ItemStatus = "new" | "update" | "exists" | "conflict";

const genId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

const isBlankObject = (value: object) =>
  Object.values(value).every((v) => v === undefined || (Array.isArray(v) && v.length === 0));

function previewStatuses(profile: Profile, facts: readonly FactInput[], text: string): ItemStatus[] {
  let current = profile;
  let drafts: Draft[] = [];
  return facts.map((fact) => {
    const blankBefore =
      (fact.section === "basics" || fact.section === "intention") && isBlankObject(current[fact.section]);
    const r = applyFacts(current, [fact], { messageId: "preview", genId, drafts, userText: text });
    current = r.profile;
    drafts = r.drafts;
    if (r.conflicts.length > 0) return "conflict";
    if (r.changes.length > 0 && blankBefore) return "new";
    if (r.changes.some((c) => c.field === "_item") || r.drafted.length > 0) return "new";
    return r.changes.length > 0 ? "update" : "exists";
  });
}

function fileNameOf(header: unknown): string | undefined {
  if (typeof header !== "string" || !header) return undefined;
  try {
    return decodeURIComponent(header).slice(0, 200);
  } catch {
    return header.slice(0, 200);
  }
}

export function resumeImportRoutes(
  app: FastifyInstance,
  deps: AppDeps & { db: NonNullable<AppDeps["db"]> },
  busy: Set<string>,
) {
  const { db } = deps;

  app.addContentTypeParser([...FILE_TYPES], { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post(
    "/api/v1/resume-import/parse",
    { bodyLimit: IMPORT_LIMITS.fileBytes + 3 * 1024 * 1024 },
    async (req, reply) => {
      const llm = deps.resumeLlm;
      if (!llm) return sendError(reply, 503, "llm_unavailable", "模型服务未配置", true);
      const fileName = fileNameOf(req.headers["x-file-name"]);
      let text: string;
      let kind: "paste" | "pdf" | "docx";
      try {
        if (Buffer.isBuffer(req.body)) {
          const detected = fileKindOf(req.headers["content-type"], fileName);
          if (detected === "doc") {
            throw new ImportError(
              "unsupported_type",
              "暂不支持老版 .doc，请另存为 .docx 或 PDF，或直接粘贴文本",
              415,
            );
          }
          if (!detected) throw new ImportError("unsupported_type", "只支持 PDF 和 Word（.docx）文件", 415);
          kind = detected;
          text = await extractResumeText(new Uint8Array(req.body), detected);
        } else {
          const body = PasteBody.safeParse(req.body);
          if (!body.success) {
            throw new ImportError(
              "text_too_long",
              `内容超过 ${IMPORT_LIMITS.textChars} 字，请只保留简历正文`,
            );
          }
          kind = "paste";
          text = checkResumeText(body.data.text, "paste");
        }
      } catch (error) {
        if (error instanceof ImportError) return sendError(reply, error.status, error.code, error.message);
        throw error;
      }

      let parsed: Awaited<ReturnType<typeof parseResumeWithLlm>>;
      try {
        parsed = await parseResumeWithLlm(llm, text);
      } catch (error) {
        req.log.warn({ err: error }, "resume import parse failed");
        return sendError(reply, 503, "parse_failed", "简历解析暂时失败，请稍后重试", true);
      }
      const { facts, dropped } = verifyImportFacts(text, parsed.facts);
      const { profile } = await loadUserMemory(db, req.userId);
      const statuses = previewStatuses(profile, facts, text);
      return {
        source: { kind, ...(fileName && { fileName }), chars: text.length },
        text,
        items: facts.map((fact, i) => ({
          fact,
          label: labelOfFact(fact.section, fact.payload as Record<string, unknown>),
          status: statuses[i],
        })),
        groups: groupImportFacts(facts),
        dropped,
      };
    },
  );

  app.post("/api/v1/resume-import/confirm", async (req, reply) => {
    const body = ConfirmBody.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "invalid_request", "请先选择要导入的内容");
    let text: string;
    try {
      text = checkResumeText(body.data.text, "paste");
    } catch (error) {
      if (error instanceof ImportError) return sendError(reply, error.status, error.code, error.message);
      throw error;
    }
    // 客户端回传的内容不可信，按原文重新核对一遍
    const { facts, dropped } = verifyImportFacts(text, body.data.facts);
    if (facts.length === 0) {
      return sendError(reply, 422, "nothing_to_import", "没有能在简历原文里找到依据的内容");
    }

    let conversationId = body.data.conversationId;
    if (conversationId) {
      if (busy.has(conversationId)) {
        return sendError(reply, 409, "conversation_busy", "上一条消息还在处理中", true);
      }
    } else {
      conversationId = await createEmptyConversation(db, req.userId, IMPORT_TITLE);
      const { summarizer } = deps;
      if (summarizer) {
        void summarizePrevious(db, summarizer, req.userId, conversationId, (err) =>
          req.log.warn({ err }, "conversation summary failed"),
        );
      }
    }
    const loaded = await loadConversation(db, req.userId, conversationId);
    if (!loaded) return sendError(reply, 404, "conversation_not_found", "会话不存在");

    busy.add(conversationId);
    try {
      const { state } = loaded;
      const userTurn = {
        id: randomUUID(),
        role: "user" as const,
        content: `${RESUME_MESSAGE_PREFIX}${text}`,
        meta: {
          resumeImport: { ...(body.data.fileName && { fileName: body.data.fileName }), facts: facts.length },
        },
      };
      state.history.push(userTurn);
      const result = applyImport(state, { messageId: userTurn.id, text, facts, genId });
      const opening = importOpening(state, result, facts);
      state.history.push({
        id: `${userTurn.id}:reply`,
        role: "assistant",
        content: opening.text,
        meta: opening.meta,
      });
      const untitled = !loaded.title;
      if (untitled) loaded.title = IMPORT_TITLE;
      await persistState(db, req.userId, conversationId, loaded);
      if (untitled) {
        await db
          .update(schema.conversations)
          .set({ title: IMPORT_TITLE })
          .where(eq(schema.conversations.id, conversationId));
      }
      return {
        conversationId,
        imported: result.facts.filter((f) => f.status === "confirmed").length,
        conflicts: state.conflicts.length,
        dropped,
      };
    } finally {
      busy.delete(conversationId);
    }
  });
}
