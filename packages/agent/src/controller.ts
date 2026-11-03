import { Agent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model, ToolResultMessage } from "@earendil-works/pi-ai";
import { errorKindOf } from "@talksume/llm-gateway";
import { computeCompleteness, SECTION_SPECS } from "./completeness.ts";
import { createIdGenerator, type ProfileChange } from "./facts.ts";
import { createJobTools, withoutCards } from "./job-tools.ts";
import { buildSystemPrompt } from "./prompt.ts";
import {
  buildUserCorpus,
  completenessEvent,
  createIntakeTools,
  lastAskedKey,
  nextSlotOf,
  normalizeQuote,
  noteAsked,
  type RunContext,
  settleConflict,
  skipDeclined,
  skippableSlot,
  skipSlot,
} from "./tools.ts";
import type {
  ChatTurn,
  IntakeEvent,
  IntakeState,
  JobCard,
  JobTools,
  ResumeTailor,
  TailorCard,
  ToolRecord,
  TurnMeta,
} from "./types.ts";

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
  /** 按岗位定制简历；需同时提供 jobs。 */
  tailor?: ResumeTailor;
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

/** 只认已完成的说法，「简历上写上 GPA 更好」这类建议不算。 */
const CLAIMS_RECORDED =
  /已(?:经)?(?:记(?:下|录|上|好)|写(?:入|进|上|好)|补(?:上|进|好)|录入|保存)|(?:记|写|补|存)(?:下|好|上|到|进|入)(?:来|去)?(?:了|啦|咯)|记录(?:好)?了/;
const CLAIM_FILLER =
  /^(?:好的?|嗯|明白了?|收到|了解|ok)|你说的|刚才(?:说)?的|帮你|给你|已经|这边|这些|这个|这条|这段|[我已也都先就把那了的]/gi;
/** 「技能记下了」「学历也记上了」这类泛指说法，只要这一轮确实写入了就算数。 */
const GENERIC_SUBJECTS = [
  ...SECTION_SPECS.flatMap((s) => [s.label, ...s.fields.map((f) => f.label)]),
  ..."信息 内容 经历 项目 实习 奖项 学历 教育 要点 经验 技术栈 本科 硕士 博士 专科 校招 社招 全职 兼职".split(
    " ",
  ),
]
  .map(normalizeQuote)
  .sort((a, b) => b.length - a.length);

/** 回复里每一处「X 记下了」的 X，泛指时为空串。 */
function claimedSubjects(text: string): string[] {
  return text.split(/[，,。！!？?；;\n]/).flatMap((clause) => {
    const hit = clause.match(CLAIMS_RECORDED);
    if (hit?.index === undefined) return [];
    const parts = clause
      .slice(0, hit.index)
      .replace(CLAIM_FILLER, "")
      .split(/以及|还有|[和及与跟、]/);
    return parts.map((part) => {
      let subject = normalizeQuote(part);
      for (const word of GENERIC_SUBJECTS) subject = subject.replaceAll(word, "");
      return subject.length >= 2 ? subject : "";
    });
  });
}

function bigrams(text: string): string[] {
  return Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2));
}

/** 原话和画像里的写法常有出入（「答辩优秀」对「毕业答辩：优秀」），按字对重合度放宽。 */
function mentioned(corpus: string, phrase: string): boolean {
  if (corpus.includes(phrase)) return true;
  const grams = bigrams(phrase);
  return grams.length > 0 && grams.filter((g) => corpus.includes(g)).length / grams.length >= 0.6;
}

/** 被说成已记下的内容尽量用用户原话复述。 */
function userWordsFor(userText: string, subject: string): string {
  const clauses = userText
    .split(/[，,。！!？?；;\n]/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (!subject) return userText.trim().slice(0, 40);
  const grams = bigrams(subject);
  const score = (c: string) => grams.filter((g) => normalizeQuote(c).includes(g)).length;
  const best = clauses.reduce<string | undefined>((a, c) => (!a || score(c) > score(a) ? c : a), undefined);
  return (best && score(best) > 0 ? best : subject).slice(0, 40);
}

function nudgeText(subjects: string[], asked: boolean): string {
  const what = subjects
    .filter(Boolean)
    .map((s) => `「${s}」`)
    .join("");
  return `[系统提示，不是用户发言] 你在回复里说已经记下${what}，但画像里没有${what ? "这些内容" : "新写入的内容"}（没有调用 upsert_facts 或调用失败）。请现在用 upsert_facts 写入用户上一条消息里对应的信息（quote 逐字摘抄原话）。${asked ? "问题已经发给用户，写完不要再输出文字，也不要再调用 ask_user。" : "写完用 ask_user 问下一个问题，不要重复前面的文字。"}`;
}

function clarifyQuestion(quote: string | undefined): string {
  return quote
    ? `我没能准确记下你说的「${quote.slice(0, 40)}」，可以再具体说一下吗？`
    : "刚才那部分我没能准确理解，可以再具体说一下吗？";
}

function sameWords(a: string, b: string): boolean {
  const x = normalizeQuote(a);
  const y = normalizeQuote(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
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

/** 只定制不解读时，岗位标签沿用之前轮次里这个岗位的匹配度。 */
function earlierJob(state: IntakeState, id: string): JobCard | undefined {
  return state.history.flatMap((t) => [t.meta?.about, ...(t.meta?.jobs ?? [])]).findLast((j) => j?.id === id);
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
    let cardSource: "recommend" | "search" = "recommend";
    let about: JobCard | undefined;
    let tailored: TailorCard | undefined;
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
          // 卡片等到本轮结束再发：之后要是讲到了具体岗位，就只显示岗位标签
          cardSource = event.source;
          for (const job of event.jobs) {
            const at = cards.findIndex((c) => c.id === job.id);
            if (at >= 0) cards[at] = { ...cards[at], ...job };
            else cards.push(job);
          }
          return;
        } else if (event.type === "about_job") {
          const known =
            about?.id === event.job.id
              ? about
              : (cards.find((c) => c.id === event.job.id) ?? earlierJob(state, event.job.id));
          about = known && event.job.score === undefined ? known : { ...known, ...event.job };
          queue.push({ type: "about_job", job: about });
          return;
        } else if (event.type === "tailor") tailored = event.tailor;
        queue.push(event);
      },
      flags,
    };

    const autoSkipped = user ? skipDeclined(state, user.text) : null;
    const completeness = computeCompleteness(state.profile, { completedSections: state.completedSections });
    const target = nextSlotOf(state);
    const systemPrompt = buildSystemPrompt({
      profile: state.profile,
      completeness,
      slot: target,
      ...(autoSkipped ? { autoSkipped } : {}),
      completedSections: state.completedSections,
      conflicts: state.conflicts,
      drafts: state.drafts,
      skipped: state.skipped,
      ...(state.summaries ? { summaries: state.summaries } : {}),
      jobTools: Boolean(deps.jobs),
      tailorTool: Boolean(deps.jobs && deps.tailor),
    });

    let assistantText = "";
    let llmError: string | undefined;
    let failures = 0;
    let writeFailures = 0;
    let lastFailedQuote: string | undefined;
    let modelTurns = 0;
    let wrote = false;
    let nudged = false;
    let skipFailed = false;
    let skipDone = false;
    const toolArgs = new Map<string, unknown>();
    const snapshot = () => JSON.stringify([state.profile, state.drafts]);
    const beforeWrite = new Map<string, string>();
    const said = normalizeQuote(user?.text ?? "");
    // 用户没说过的词（「联系方式」「时间线」）是模型的概括，只看这一轮写没写；用户原话里的具体内容要真在画像里
    const unrecorded = (): string[] => {
      const corpus = normalizeQuote(snapshot());
      return claimedSubjects(assistantText).filter((s) =>
        s && mentioned(said, s) ? !mentioned(corpus, s) : !wrote,
      );
    };

    const agent = new Agent({
      initialState: {
        systemPrompt,
        model: deps.model,
        thinkingLevel: "off",
        tools: [
          ...createIntakeTools(ctx),
          ...(deps.jobs ? createJobTools(ctx, deps.jobs, toolLog, deps.tailor) : []),
        ],
        messages: historyToMessages(state, deps.model, historyLimit),
      },
      streamFn: deps.streamFn,
      toolExecution: "sequential",
      finishTurn: (turn) => {
        if (turn.message.role === "assistant" && turn.message.stopReason === "error") return;
        modelTurns++;
        const calledTool =
          turn.message.role === "assistant" && turn.message.content.some((c) => c.type === "toolCall");
        const stopping = flags.asked || !calledTool;
        if (user && stopping && !nudged && failures < 2 && modelTurns < maxModelTurns) {
          const missed = unrecorded();
          if (missed.length > 0) {
            nudged = true;
            agent.followUp({ role: "user", content: nudgeText(missed, flags.asked), timestamp: Date.now() });
            return { action: "continue" };
          }
        }
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
          if (event.toolName === "upsert_facts") beforeWrite.set(event.toolCallId, snapshot());
          break;
        case "tool_execution_end":
          if (event.toolName === "skip_field") {
            if (event.isError) skipFailed = true;
            else skipDone = true;
          }
          if (event.toolName === "upsert_facts" && !event.isError) {
            if (beforeWrite.get(event.toolCallId) !== snapshot()) wrote = true;
          }
          if (event.isError) {
            failures++;
            if (event.toolName !== "upsert_facts") break;
            writeFailures++;
            const args = toolArgs.get(event.toolCallId) as { facts?: { quote?: unknown }[] } | undefined;
            const quote = args?.facts?.find((f) => typeof f?.quote === "string")?.quote;
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
    if (!about && cards.length > 0) yield { type: "jobs", source: cardSource, jobs: cards };

    // 模型想跳过却没跳成：按上一轮问的（或本轮目标）字段替它跳过，免得下一轮又卡在同一处
    if (user && skipFailed && !skipDone) {
      const asked = lastAskedKey(state);
      const slot = (asked && skippableSlot(state, asked)) || (target && skippableSlot(state, target.key));
      if (slot) {
        skipSlot(state, slot, user.text.trim().slice(0, 40));
        flags.changed = true;
      }
    }

    // 问题已经说出口后才卡住的，用户拿到的回复是完整的，不再报错
    const delivered = flags.asked || /[?？]/.test(assistantText);
    const missed = user && !llmError ? unrecorded() : [];
    const previous = state.history.findLast((t) => t.role === "assistant")?.meta?.clarified;
    const failedWords = lastFailedQuote ?? user?.text ?? "";
    let clarified: string | undefined;
    if (llmError && !delivered) {
      const kind = errorKindOf(llmError) ?? "unknown";
      yield {
        type: "error",
        code: kind,
        message: llmError.replace(/^\[llm:[a-z_]+\] /, ""),
        recoverable: kind !== "quota_exhausted" && kind !== "auth",
      };
    } else if (user && missed.length > 0) {
      const words = [...new Set(missed.map((s) => userWordsFor(user.text, s)))]
        .map((w) => `「${w}」`)
        .join("");
      const question = delivered
        ? `刚才说的${words}其实还没记进简历，回头可以再具体说一下。`
        : `刚才说的${words}还没记进简历，能再具体说一下吗？`;
      asks.push(question);
      yield {
        type: "ask",
        kind: "clarify",
        question,
        ...(quickReplies.length > 0 ? { quickReplies } : {}),
      };
    } else if (
      writeFailures > 0 &&
      failures >= 2 &&
      !flags.asked &&
      !(previous && sameWords(previous, failedWords))
    ) {
      const question = clarifyQuestion(lastFailedQuote);
      asks.push(question);
      clarified = failedWords;
      askedSlot ??= lastAskedKey(state);
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
      ...(clarified ? { clarified } : {}),
      ...(about ? { about } : cards.length > 0 ? { jobs: cards } : {}),
      ...(tailored ? { tailor: tailored } : {}),
      ...(toolLog.length > 0 ? { tools: about ? withoutCards(toolLog) : toolLog } : {}),
    };
    if (!llmError || flags.changed || changes.length > 0 || cards.length > 0 || about || tailored) {
      if (user) state.history.push({ id: user.id, role: "user", content: user.text });
      if (user || reply || changes.length > 0) {
        state.history.push({
          id: `${turn.id}:reply`,
          role: "assistant",
          content: reply || (user && changes.length > 0 ? "（已记录）" : ""),
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
