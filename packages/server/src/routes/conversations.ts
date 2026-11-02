import { randomUUID } from "node:crypto";
import {
  computeCompleteness,
  createIntakeController,
  createIntakeState,
  type IntakeEvent,
  nextSlotOf,
  noteAsked,
} from "@talksume/agent";
import { profileToResume } from "@talksume/core";
import { z } from "zod";
import type { LlmDeps, RouteModule } from "../app.ts";
import {
  createConversation,
  listConversations,
  loadConversation,
  loadMessages,
  persistState,
} from "../conversation-store.ts";
import { openSse, sendError } from "../http.ts";
import { resumeRoutes } from "./resume.ts";

const GREETING = "你好，我是简聊助手。接下来我们边聊边整理简历，聊到哪里都可以先停，下次接着来。";
const KEEPALIVE_MS = 15_000;

const MessageBody = z.object({ content: z.string().trim().min(1).max(4000) });
const ConflictBody = z.object({ choice: z.enum(["proposed", "previous"]) });

// confirmConflict 不调用模型，没配 LLM 时也要能处理待确认项
const NO_LLM: LlmDeps = {
  streamFn: () => {
    throw new Error("llm unavailable");
  },
  model: {} as LlmDeps["model"],
};

const genId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

export const conversationRoutes: RouteModule = (app, deps) => {
  const { db } = deps;
  const busy = new Set<string>();

  const snapshotOf = (state: ReturnType<typeof createIntakeState>) => ({
    profile: state.profile,
    completeness: computeCompleteness(state.profile, { completedSections: state.completedSections }),
    resume: profileToResume(state.profile),
    conflicts: state.conflicts,
  });

  app.post("/api/v1/conversations", async (req, reply) => {
    const state = createIntakeState();
    const slot = nextSlotOf(state);
    noteAsked(state, slot);
    const greeting = { id: randomUUID(), text: slot ? `${GREETING}${slot.question}` : GREETING };
    state.history.push({ id: greeting.id, role: "assistant", content: greeting.text });
    const id = await createConversation(db, req.userId, state, greeting);
    return reply.code(201).send({ id, greeting: greeting.text });
  });

  app.get("/api/v1/conversations", async (req) => {
    const rows = await listConversations(db, req.userId);
    return { items: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })) };
  });

  app.get("/api/v1/conversations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const loaded = await loadConversation(db, req.userId, id);
    if (!loaded) return sendError(reply, 404, "conversation_not_found", "会话不存在");
    const stored = await loadMessages(db, id);
    return {
      id,
      title: loaded.title,
      messages: stored.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
      ...snapshotOf(loaded.state),
    };
  });

  app.post("/api/v1/conversations/:id/messages", async (req, reply) => {
    const llm = deps.llm;
    if (!llm) return sendError(reply, 503, "llm_unavailable", "模型服务未配置", true);
    const { id } = req.params as { id: string };
    const body = MessageBody.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "invalid_request", "content 不能为空且不超过 4000 字");
    const loaded = await loadConversation(db, req.userId, id);
    if (!loaded) return sendError(reply, 404, "conversation_not_found", "会话不存在");
    if (busy.has(id)) return sendError(reply, 409, "conversation_busy", "上一条消息还在处理中", true);

    busy.add(id);
    const sse = openSse(reply);
    const abort = new AbortController();
    let finished = false;
    reply.raw.on("close", () => {
      if (!finished) abort.abort();
    });
    const keepalive = setInterval(() => sse.ping(), KEEPALIVE_MS);
    const emit = (event: IntakeEvent) => sse.send(event.type, event);

    try {
      const controller = createIntakeController({ streamFn: llm.streamFn, model: llm.model, genId });
      const messageId = randomUUID();
      try {
        for await (const event of controller.handleUserMessage(
          loaded.state,
          { id: messageId, text: body.data.content },
          { signal: abort.signal },
        )) {
          emit(event);
        }
      } catch (error) {
        req.log.error({ err: error }, "intake failed");
        emit({ type: "error", code: "internal", message: "对话处理失败，请重试", recoverable: true });
      }

      if (!abort.signal.aborted) {
        const persisted = await persistState(db, req.userId, id, loaded).then(
          () => true,
          (error: unknown) => {
            req.log.error({ err: error }, "persist failed");
            emit({ type: "error", code: "persist_failed", message: "保存失败，请重试", recoverable: true });
            return false;
          },
        );
        const replied = persisted && loaded.state.history.length > loaded.snapshot.historyLength;
        sse.send("done", {
          messageId: replied ? `${messageId}:reply` : null,
          resume: profileToResume(loaded.state.profile),
        });
      }
    } finally {
      finished = true;
      clearInterval(keepalive);
      busy.delete(id);
      sse.end();
    }
  });

  app.post("/api/v1/conversations/:id/conflicts/:conflictId", async (req, reply) => {
    const { id, conflictId } = req.params as { id: string; conflictId: string };
    const body = ConflictBody.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "invalid_request", "choice 必须是 proposed 或 previous");
    const loaded = await loadConversation(db, req.userId, id);
    if (!loaded) return sendError(reply, 404, "conversation_not_found", "会话不存在");
    if (!loaded.state.conflicts.some((c) => c.factId === conflictId)) {
      return sendError(reply, 404, "conflict_not_found", "该待确认项不存在或已处理");
    }
    if (busy.has(id)) return sendError(reply, 409, "conversation_busy", "上一条消息还在处理中", true);

    const controller = createIntakeController(deps.llm ?? NO_LLM);
    const events = controller.confirmConflict(loaded.state, conflictId, body.data.choice === "proposed");
    await persistState(db, req.userId, id, loaded);
    return { events, ...snapshotOf(loaded.state) };
  });

  resumeRoutes(app, deps);
};
