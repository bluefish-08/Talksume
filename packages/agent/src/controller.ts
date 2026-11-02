import { Agent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model, ToolResultMessage } from "@earendil-works/pi-ai";
import { errorKindOf } from "@talksume/llm-gateway";
import { computeCompleteness } from "./completeness.ts";
import { createIdGenerator, type ProfileChange } from "./facts.ts";
import { createJobTools } from "./job-tools.ts";
import { buildSystemPrompt } from "./prompt.ts";
import {
  buildUserCorpus,
  completenessEvent,
  createIntakeTools,
  nextSlotOf,
  noteAsked,
  type RunContext,
  settleConflict,
  skipUnquantified,
} from "./tools.ts";
import type { ChatTurn, IntakeEvent, IntakeState, JobCard, JobTools, ToolRecord, TurnMeta } from "./types.ts";

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
  /** 岗位推荐与解读；不传则助手只建档。 */
  jobs?: JobTools;
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
  const assistant = (content: AssistantMessage["content"], toolUse = false): AssistantMessage => ({
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: ZERO_USAGE,
    stopReason: toolUse ? "toolUse" : "stop",
    timestamp: now,
  });
  const replayTools = (turn: ChatTurn, index: number): AgentMessage[] => {
    const records = turn.meta?.tools ?? [];
    if (records.length === 0) return [];
    const ids = records.map((_, i) => `hist_${index}_${i}`);
    const calls = assistant(
      records.map((r, i) => ({
        type: "toolCall" as const,
        id: ids[i] ?? "",
        name: r.name,
        arguments: r.args as never,
      })),
      true,
    );
    const results = records.map(
      (r, i): ToolResultMessage => ({
        role: "toolResult",
        toolCallId: ids[i] ?? "",
        toolName: r.name,
        content: [{ type: "text", text: r.result }],
        isError: false,
        timestamp: now,
      }),
    );
    return [calls, ...results];
  };
  return state.history
    .slice(-limit)
    .filter((turn) => turn.content.trim())
    .flatMap((turn, index): AgentMessage[] => {
      if (turn.role === "user") return [{ role: "user", content: turn.content, timestamp: now }];
      return [...replayTools(turn, index), assistant([{ type: "text", text: turn.content }])];
    });
}

const CLAIMS_RECORDED = /记(?:下|好|上|到|一下)|写(?:进|入|上)|补(?:到|上|进)|已记录/;
const NUDGE =
  "[系统提示，不是用户发言] 你在回复里说已经记下，但这一轮没有调用 upsert_facts，画像里还没有这些信息。请现在用 upsert_facts 写入用户上一条消息里的信息（quote 逐字摘抄原话），然后用 ask_user 问下一个问题，不要重复前面的文字。";

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
  /** 只改画像不调模型，事件以 completeness 收尾。 */
  confirmConflict(state: IntakeState, factId: string, accept: boolean): IntakeEvent[];
  /** 用户对「待确认」卡片做出选择后调用；没有剩余矛盾时同一轮内让模型接着追问。 */
  resolveConflict(
    state: IntakeState,
    factId: string,
    accept: boolean,
    options?: { signal?: AbortSignal; continueTurn?: boolean },
  ): AsyncGenerator<IntakeEvent, void>;
}

export function createIntakeController(deps: IntakeDeps): IntakeController {
  const genId = deps.genId ?? createIdGenerator();
  const verifyQuote = deps.verifyQuote ?? true;
  const maxModelTurns = deps.maxModelTurns ?? 5;
  const historyLimit = deps.historyLimit ?? 24;

  interface Turn {
    /** 助手回复的 id 为 `${id}:reply`；有 user 时 id 即用户消息 id。 */
    id: string;
    user?: UserMessage;
    prompt: string;
    /** 本轮之前已写入、需要一并挂到助手消息上的变更。 */
    seedChanges?: ProfileChange[];
  }

  async function* runTurn(
    state: IntakeState,
    turn: Turn,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<IntakeEvent, void> {
    const { user } = turn;
    const queue = new EventQueue();
    const asks: string[] = [];
    const changes: ProfileChange[] = [...(turn.seedChanges ?? [])];
    let quickReplies: string[] = [];
    let askedSlot: string | undefined;
    const cards: JobCard[] = [];
    const toolLog: ToolRecord[] = [];
    const flags: RunContext["flags"] = { asked: false, changed: false };
    const userTexts = [
      ...state.history.filter((t) => t.role === "user").map((t) => t.content),
      ...(user ? [user.text] : []),
    ];
    const ctx: RunContext = {
      state,
      messageId: turn.id,
      userCorpus: buildUserCorpus(userTexts),
      verifyQuote,
      genId,
      emit: (event) => {
        if (event.type === "ask") {
          if (event.quickReplies) quickReplies = event.quickReplies;
          if (event.slot) askedSlot = event.slot.key;
          // 每条回复恰好带一个问题：正文已经问了就以正文为准，没问才用 ask_user 的 question
          if (event.kind === "followup" && /[?？]/.test(assistantText)) {
            queue.push({ ...event, inText: true });
            return;
          }
          asks.push(event.question);
        } else if (event.type === "profile_patch") changes.push(...event.changes);
        else if (event.type === "jobs") {
          for (const job of event.jobs) {
            const at = cards.findIndex((c) => c.id === job.id);
            if (at >= 0) cards[at] = { ...cards[at], ...job };
            else cards.push(job);
          }
        }
        queue.push(event);
      },
      flags,
    };

    if (user) skipUnquantified(state, user.text);
    const completeness = computeCompleteness(state.profile, { completedSections: state.completedSections });
    const systemPrompt = buildSystemPrompt({
      profile: state.profile,
      completeness,
      slot: nextSlotOf(state),
      completedSections: state.completedSections,
      conflicts: state.conflicts,
      drafts: state.drafts,
      skipped: state.skipped,
      ...(state.summaries ? { summaries: state.summaries } : {}),
      jobTools: Boolean(deps.jobs),
    });

    let assistantText = "";
    let llmError: string | undefined;
    let failures = 0;
    let lastFailedQuote: string | undefined;
    let modelTurns = 0;
    let wrote = false;
    let nudged = false;
    const toolArgs = new Map<string, unknown>();

    const agent = new Agent({
      initialState: {
        systemPrompt,
        model: deps.model,
        thinkingLevel: "off",
        tools: [...createIntakeTools(ctx), ...(deps.jobs ? createJobTools(ctx, deps.jobs, toolLog) : [])],
        messages: historyToMessages(state, deps.model, historyLimit),
      },
      streamFn: deps.streamFn,
      toolExecution: "sequential",
      finishTurn: (turn) => {
        if (turn.message.role === "assistant" && turn.message.stopReason === "error") return;
        modelTurns++;
        if (flags.asked || failures >= 2 || modelTurns >= maxModelTurns) return { action: "end" };
        // 关思考时模型偶尔只回一句「记下了」却没调工具，提醒一次
        const calledTool =
          turn.message.role === "assistant" && turn.message.content.some((c) => c.type === "toolCall");
        if (user && !wrote && !nudged && !calledTool && CLAIMS_RECORDED.test(assistantText)) {
          nudged = true;
          agent.followUp({ role: "user", content: NUDGE, timestamp: Date.now() });
          return { action: "continue" };
        }
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
          if (event.toolName === "upsert_facts") wrote = true;
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
      .prompt(turn.prompt)
      .catch((error: unknown) => {
        llmError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => queue.close());

    for await (const event of queue) yield event;
    await run;

    if (options.signal?.aborted) return;

    // 问题已经说出口后才卡住的，用户拿到的回复是完整的，不再报错
    const delivered = flags.asked || /[?？]/.test(assistantText);
    if (llmError && !delivered) {
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
    } else if (!flags.asked && !flags.jobs) {
      const slot = nextSlotOf(state);
      if (slot && !/[?？]/.test(assistantText)) {
        noteAsked(state, slot);
        asks.push(slot.question);
        askedSlot = slot.key;
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
    const meta: TurnMeta = {
      ...(changes.length > 0 ? { changes } : {}),
      ...(quickReplies.length > 0 ? { quickReplies } : {}),
      ...(askedSlot ? { slot: askedSlot } : {}),
      ...(cards.length > 0 ? { jobs: cards } : {}),
      ...(toolLog.length > 0 ? { tools: toolLog } : {}),
    };
    if (!llmError || flags.changed || changes.length > 0 || cards.length > 0) {
      if (user) state.history.push({ id: user.id, role: "user", content: user.text });
      if (user || reply || changes.length > 0) {
        state.history.push({
          id: `${turn.id}:reply`,
          role: "assistant",
          content: reply || (user ? "（已记录）" : ""),
          ...(Object.keys(meta).length > 0 ? { meta } : {}),
        });
      }
    }
    yield completenessEvent(state);
  }

  function handleUserMessage(
    state: IntakeState,
    message: UserMessage,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<IntakeEvent, void> {
    return runTurn(state, { id: message.id, user: message, prompt: message.text }, options);
  }

  function confirmConflict(state: IntakeState, factId: string, accept: boolean): IntakeEvent[] {
    return settleConflict(state, factId, accept);
  }

  async function* resolveConflictAndContinue(
    state: IntakeState,
    factId: string,
    accept: boolean,
    options: { signal?: AbortSignal; continueTurn?: boolean } = {},
  ): AsyncGenerator<IntakeEvent, void> {
    const conflict = state.conflicts.find((c) => c.factId === factId);
    if (!conflict) return;
    const events = confirmConflict(state, factId, accept);
    const completeness = events.pop();
    for (const event of events) yield event;

    const id = `resolve_${factId}`;
    const changes = events.flatMap((e) => (e.type === "profile_patch" ? e.changes : []));
    if (state.conflicts.length > 0 || options.continueTurn === false) {
      const question = events.flatMap((e) => (e.type === "ask" ? [e.question] : [])).join("\n");
      if (changes.length > 0 || question) {
        state.history.push({
          id: `${id}:reply`,
          role: "assistant",
          content: question,
          ...(changes.length > 0 ? { meta: { changes } } : {}),
        });
      }
      if (completeness) yield completeness;
      return;
    }

    const label = conflict.label;
    const chosen = String(accept ? conflict.proposed : conflict.previous);
    const prompt = `[系统通知，不是用户发言] 用户确认${label}以「${chosen}」为准，画像已更新。没有新的信息需要写入，请直接用 ask_user 接着问当前目标字段的下一个问题。`;
    yield* runTurn(state, { id, prompt, seedChanges: changes }, options);
  }

  return { handleUserMessage, confirmConflict, resolveConflict: resolveConflictAndContinue };
}
