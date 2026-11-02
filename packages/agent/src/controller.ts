import { Agent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { errorKindOf } from "@talksume/llm-gateway";
import { computeCompleteness } from "./completeness.ts";
import { createIdGenerator, resolveConflict } from "./facts.ts";
import { buildSystemPrompt } from "./prompt.ts";
import {
  buildUserCorpus,
  confirmQuestion,
  createIntakeTools,
  nextSlotOf,
  noteAsked,
  type RunContext,
} from "./tools.ts";
import type { IntakeEvent, IntakeState } from "./types.ts";

export interface IntakeDeps {
  streamFn: StreamFn;
  model: Model<Api>;
  genId?: (prefix: string) => string;
  /** 核对 upsert_facts 的 quote 确为用户原话，默认开启。 */
  verifyQuote?: boolean;
  /** 单次用户消息内最多的模型轮数（含工具往返）。 */
  maxModelTurns?: number;
  /** 注入模型的历史消息条数上限。 */
  historyLimit?: number;
}

export interface UserMessage {
  id: string;
  text: string;
}

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

class EventQueue {
  private items: IntakeEvent[] = [];
  private waiter: (() => void) | undefined;
  private closed = false;

  push(event: IntakeEvent) {
    this.items.push(event);
    this.wake();
  }

  close() {
    this.closed = true;
    this.wake();
  }

  private wake() {
    this.waiter?.();
    this.waiter = undefined;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<IntakeEvent> {
    for (;;) {
      const next = this.items.shift();
      if (next) yield next;
      else if (this.closed) return;
      else await new Promise<void>((resolve) => (this.waiter = resolve));
    }
  }
}

function historyToMessages(state: IntakeState, model: Model<Api>, limit: number): AgentMessage[] {
  const now = Date.now();
  return state.history.slice(-limit).map((turn): AgentMessage => {
    if (turn.role === "user") return { role: "user", content: turn.content, timestamp: now };
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: turn.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: ZERO_USAGE,
      stopReason: "stop",
      timestamp: now,
    };
    return message;
  });
}

function clarifyQuestion(quote: string | undefined): string {
  return quote
    ? `我没能准确记下你说的「${quote.slice(0, 40)}」，可以再具体说一下吗？`
    : "刚才那部分我没能准确理解，可以再具体说一下吗？";
}

export interface IntakeController {
  handleUserMessage(
    state: IntakeState,
    message: UserMessage,
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<IntakeEvent, void>;
  /** 用户对「待确认」卡片做出选择后调用。 */
  confirmConflict(state: IntakeState, factId: string, accept: boolean): IntakeEvent[];
}

export function createIntakeController(deps: IntakeDeps): IntakeController {
  const genId = deps.genId ?? createIdGenerator();
  const verifyQuote = deps.verifyQuote ?? true;
  const maxModelTurns = deps.maxModelTurns ?? 4;
  const historyLimit = deps.historyLimit ?? 24;

  function completenessEvent(state: IntakeState): IntakeEvent {
    return {
      type: "completeness",
      completeness: computeCompleteness(state.profile, { completedSections: state.completedSections }),
      nextSlot: nextSlotOf(state),
    };
  }

  async function* handleUserMessage(
    state: IntakeState,
    message: UserMessage,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<IntakeEvent, void> {
    const queue = new EventQueue();
    const asks: string[] = [];
    const flags = { asked: false, changed: false };
    const userTexts = [...state.history.filter((t) => t.role === "user").map((t) => t.content), message.text];
    const ctx: RunContext = {
      state,
      messageId: message.id,
      userCorpus: buildUserCorpus(userTexts),
      verifyQuote,
      genId,
      emit: (event) => {
        if (event.type === "ask") asks.push(event.question);
        queue.push(event);
      },
      flags,
    };

    const completeness = computeCompleteness(state.profile, { completedSections: state.completedSections });
    const systemPrompt = buildSystemPrompt({
      profile: state.profile,
      completeness,
      slot: nextSlotOf(state),
      completedSections: state.completedSections,
      conflicts: state.conflicts,
    });

    let assistantText = "";
    let llmError: string | undefined;
    let failures = 0;
    let lastFailedQuote: string | undefined;
    let modelTurns = 0;
    const toolArgs = new Map<string, unknown>();

    const agent = new Agent({
      initialState: {
        systemPrompt,
        model: deps.model,
        thinkingLevel: "off",
        tools: createIntakeTools(ctx),
        messages: historyToMessages(state, deps.model, historyLimit),
      },
      streamFn: deps.streamFn,
      toolExecution: "sequential",
      finishTurn: (turn) => {
        if (turn.message.role === "assistant" && turn.message.stopReason === "error") return;
        modelTurns++;
        if (flags.asked || failures >= 2 || modelTurns >= maxModelTurns) return { action: "end" };
      },
    });

    agent.subscribe((event) => {
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent.type === "text_delta") {
            assistantText += event.assistantMessageEvent.delta;
            queue.push({ type: "token", text: event.assistantMessageEvent.delta });
          }
          break;
        case "message_end":
          if (event.message.role === "assistant" && event.message.stopReason === "error") {
            llmError = event.message.errorMessage ?? "unknown error";
          }
          break;
        case "tool_execution_start":
          toolArgs.set(event.toolCallId, event.args);
          break;
        case "tool_execution_end":
          if (event.isError) {
            failures++;
            const args = toolArgs.get(event.toolCallId) as
              | { facts?: { quote?: unknown }[]; quote?: unknown }
              | undefined;
            const quote = args?.facts?.find((f) => typeof f?.quote === "string")?.quote ?? args?.quote;
            if (typeof quote === "string") lastFailedQuote = quote;
          }
          break;
      }
    });

    options.signal?.addEventListener("abort", () => agent.abort(), { once: true });

    const run = agent
      .prompt(message.text)
      .catch((error: unknown) => {
        llmError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => queue.close());

    for await (const event of queue) yield event;
    await run;

    if (options.signal?.aborted) return;

    if (llmError && !flags.asked) {
      const kind = errorKindOf(llmError) ?? "unknown";
      yield {
        type: "error",
        code: kind,
        message: llmError.replace(/^\[llm:[a-z_]+\] /, ""),
        recoverable: kind !== "quota_exhausted" && kind !== "auth",
      };
    } else if (failures >= 2 && !flags.asked) {
      const question = clarifyQuestion(lastFailedQuote);
      asks.push(question);
      yield { type: "ask", kind: "clarify", question };
    } else if (!flags.asked) {
      const slot = nextSlotOf(state);
      if (slot && !/[?？]\s*$/.test(assistantText.trim())) {
        noteAsked(state, slot);
        asks.push(slot.question);
        yield {
          type: "ask",
          kind: "followup",
          question: slot.question,
          slot: {
            key: slot.key,
            section: slot.section,
            field: slot.field,
            ...(slot.itemId ? { itemId: slot.itemId } : {}),
          },
        };
      }
    }

    const reply = [assistantText.trim(), ...asks].filter(Boolean).join("\n");
    if (!llmError || flags.changed) {
      state.history.push({ id: message.id, role: "user", content: message.text });
      state.history.push({ id: `${message.id}:reply`, role: "assistant", content: reply || "（已记录）" });
    }
    yield completenessEvent(state);
  }

  function confirmConflict(state: IntakeState, factId: string, accept: boolean): IntakeEvent[] {
    const conflict = state.conflicts.find((c) => c.factId === factId);
    if (!conflict) return [];
    const resolved = resolveConflict(state.profile, state.facts, conflict, accept);
    state.profile = resolved.profile;
    state.facts = resolved.facts;
    state.conflicts = state.conflicts.filter((c) => c.factId !== factId);
    const events: IntakeEvent[] = [];
    if (resolved.changes.length > 0) {
      events.push({
        type: "profile_patch",
        changes: resolved.changes,
        facts: state.facts.filter((f) => f.id === factId),
        profile: state.profile,
      });
    }
    const remaining = state.conflicts[0];
    if (remaining) {
      events.push({
        type: "ask",
        kind: "confirm",
        question: confirmQuestion(remaining),
        conflict: remaining,
      });
    }
    events.push(completenessEvent(state));
    return events;
  }

  return { handleUserMessage, confirmConflict };
}
