import { randomUUID } from "node:crypto";
import {
  computeCompleteness,
  createIntakeController,
  createIntakeState,
  type IntakeEvent,
  nextSlotOf,
  noteAsked,
  openingMessage,
  topicOfFacts,
} from "@talksume/agent";
import { profileToResume } from "@talksume/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { LlmDeps, RouteModule, TurnReport } from "../app.ts";
import { summarizePrevious } from "../conversation-memory.ts";
import {
  createConversation,
  deleteConversation,
  type LoadedConversation,
  listConversations,
  loadConversation,
  loadMessages,
  loadUserMemory,
  persistState,
  restoreConversation,
} from "../conversation-store.ts";
import { createTitleScheduler } from "../conversation-title.ts";
import { openSse, sendError } from "../http.ts";
import { matchingJobTools, storeResumeTailor } from "../job-tools.ts";
import { storeResumeStyler } from "../resume-style.ts";
import { matchingServiceFor } from "./matching.ts";
import { resumeRoutes } from "./resume.ts";
import { resumeImportRoutes } from "./resume-import.ts";

const KEEPALIVE_MS = 15_000;

const MessageBody = z.object({
  content: z.string().trim().min(1).max(4000),
  model: z.string().optional(),
  thinking: z.boolean().optional(),
});
const ConflictBody = z.object({ choice: z.enum(["proposed", "previous"]) });

const DEFAULT_THINKING = true;

// confirmConflict 不调用模型，没配 LLM 时也要能处理待确认项
const NO_LLM: ReturnType<LlmDeps["resolve"]> = {
  streamFn: () => {
    throw new Error("llm unavailable");
  },
  model: {} as ReturnType<LlmDeps["resolve"]>["model"],
};

const genId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

export const conversationRoutes: RouteModule = (app, deps) => {
  const { db } = deps;
  const busy = new Set<string>();
  const titles = createTitleScheduler(db, deps.titler, app.log);
  const reportTurn = (req: FastifyRequest, metrics: TurnReport) => {
    req.log.info({ turn: metrics }, "chat turn");
    deps.onTurnMetrics?.(metrics);
  };
  app.addHook("onClose", () => titles.drain());
  const jobService = matchingServiceFor(db, deps.matching ?? {}, app.log);
  const chatTools = (userId: string) => ({
    jobs: matchingJobTools(jobService, userId),
    ...(deps.resumeLlm && { tailor: storeResumeTailor(db, deps.resumeLlm, userId) }),
    styles: storeResumeStyler(db, userId),
  });

  const snapshotOf = (state: ReturnType<typeof createIntakeState>) => ({
    profile: state.profile,
    completeness: computeCompleteness(state.profile, { completedSections: state.completedSections }),
    resume: profileToResume(state.profile),
    conflicts: state.conflicts,
  });

  const defaultModel = deps.llm?.models[0]?.id ?? "";
  const resolveDefault = () =>
    deps.llm ? deps.llm.resolve({ model: defaultModel, thinking: DEFAULT_THINKING }) : NO_LLM;

  app.get("/api/v1/llm/options", async (_req, reply) => {
    const llm = deps.llm;
    if (!llm) return sendError(reply, 503, "llm_unavailable", "模型服务未配置", true);
    return { models: llm.models, default: { model: defaultModel, thinking: DEFAULT_THINKING } };
  });

  app.post("/api/v1/conversations", async (req, reply) => {
    const { profile, facts, ledger, summaries } = await loadUserMemory(db, req.userId);
    const state = createIntakeState({ profile, facts, ...structuredClone(ledger) });
    const slot = nextSlotOf(state);
    noteAsked(state, slot);
    const topic = summaries[0]?.topic ?? topicOfFacts(facts);
    const greeting = {
      id: randomUUID(),
      text: openingMessage({ profile, slot, topic }),
      ...(slot ? { slot: slot.key } : {}),
    };
    state.history.push({
      id: greeting.id,
      role: "assistant",
      content: greeting.text,
      ...(slot ? { meta: { slot: slot.key } } : {}),
    });
    const id = await createConversation(db, req.userId, state, greeting, ledger);
    const { summarizer } = deps;
    if (summarizer) {
      void summarizePrevious(db, summarizer, req.userId, id, (err) =>
        req.log.warn({ err }, "conversation summary failed"),
      );
    }
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
        changes: m.meta.changes ?? [],
        quickReplies: m.meta.quickReplies ?? [],
        jobs: m.meta.jobs ?? [],
        ...(m.meta.about && { about: m.meta.about }),
        ...(m.meta.tailor && { tailor: m.meta.tailor }),
        ...(m.meta.resumeImport && { resumeImport: m.meta.resumeImport }),
        createdAt: m.createdAt.toISOString(),
      })),
      ...snapshotOf(loaded.state),
    };
  });

  app.delete("/api/v1/conversations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await deleteConversation(db, req.userId, id))) {
      return sendError(reply, 404, "conversation_not_found", "会话不存在");
    }
    return reply.code(204).send();
  });

  app.post("/api/v1/conversations/:id/restore", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await restoreConversation(db, req.userId, id);
    if (!row) return sendError(reply, 404, "conversation_not_found", "会话不存在");
    return { ...row, updatedAt: row.updatedAt.toISOString() };
  });

  /** 接管响应，把一轮对话的事件流式推出，结束后落库并发 done。 */
  async function streamTurn(
    req: FastifyRequest,
    reply: FastifyReply,
    id: string,
    loaded: LoadedConversation,
    replyId: string,
    produce: (signal: AbortSignal) => AsyncGenerator<IntakeEvent, void>,
  ) {
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
      try {
        for await (const event of produce(abort.signal)) emit(event);
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
          messageId: replied ? replyId : null,
          titlePending: persisted && titles.schedule(id, loaded),
          resume: profileToResume(loaded.state.profile),
          conflicts: loaded.state.conflicts,
        });
      }
    } finally {
      finished = true;
      clearInterval(keepalive);
      busy.delete(id);
      sse.end();
    }
  }

  app.post("/api/v1/conversations/:id/messages", async (req, reply) => {
    const llm = deps.llm;
    if (!llm) return sendError(reply, 503, "llm_unavailable", "模型服务未配置", true);
    const { id } = req.params as { id: string };
    const body = MessageBody.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "invalid_request", "content 不能为空且不超过 4000 字");
    const { model = defaultModel, thinking = DEFAULT_THINKING } = body.data;
    if (!llm.models.some((m) => m.id === model)) {
      return sendError(reply, 400, "invalid_model", "不支持的模型");
    }
    const loaded = await loadConversation(db, req.userId, id);
    if (!loaded) return sendError(reply, 404, "conversation_not_found", "会话不存在");
    if (busy.has(id)) return sendError(reply, 409, "conversation_busy", "上一条消息还在处理中", true);

    const controller = createIntakeController({
      ...llm.resolve({ model, thinking }),
      genId,
      ...chatTools(req.userId),
      onMetrics: (metrics) => reportTurn(req, { conversationId: id, model, ...metrics }),
    });
    const messageId = randomUUID();
    await streamTurn(req, reply, id, loaded, `${messageId}:reply`, (signal) =>
      controller.handleUserMessage(loaded.state, { id: messageId, text: body.data.content }, { signal }),
    );
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

    const controller = createIntakeController({
      ...resolveDefault(),
      ...chatTools(req.userId),
      onMetrics: (metrics) => reportTurn(req, { conversationId: id, ...metrics }),
    });
    await streamTurn(req, reply, id, loaded, `resolve_${conflictId}:reply`, (signal) =>
      controller.resolveConflict(loaded.state, conflictId, body.data.choice === "proposed", {
        signal,
        continueTurn: Boolean(deps.llm),
      }),
    );
  });

  resumeRoutes(app, deps);
  resumeImportRoutes(app, deps, busy);
};
