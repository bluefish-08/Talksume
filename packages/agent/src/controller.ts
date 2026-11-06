import { Agent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model, ToolResultMessage } from "@earendil-works/pi-ai";
import { pickDirections } from "@talksume/core";
import { errorKindOf, isRetryableKind } from "@talksume/llm-gateway";
import { computeCompleteness, SECTION_SPECS } from "./completeness.ts";
import { createIdGenerator, type ProfileChange } from "./facts.ts";
import { createJobTools, withoutCards } from "./job-tools.ts";
import { buildSystemPrompt, RESUME_HINT } from "./prompt.ts";
import { cleanQuickReplies } from "./schemas.ts";
import { createStyleTools } from "./style-tools.ts";
import {
  answeredSlot,
  buildUserCorpus,
  completenessEvent,
  createIntakeTools,
  isClosed,
  isPleasantry,
  lastAskedKey,
  nextSlotOf,
  normalizeQuote,
  noteAsked,
  planNext,
  type RunContext,
  settleConflict,
  skipDeclined,
  slotQuestion,
  wrapsUp,
} from "./tools.ts";
import type {
  ChatImage,
  ChatTurn,
  DesignOption,
  IntakeEvent,
  IntakeState,
  JobCard,
  JobTools,
  ResumeStyler,
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
  /** 对话里定制简历样式；不传则不开放 design_resume_style。 */
  styles?: ResumeStyler;
  /** 挑候选设计方向用的随机源，测试里固定它。 */
  random?: () => number;
  /** 每轮结束时回报耗时，时间都相对本轮开始，单位毫秒。 */
  onMetrics?: (metrics: TurnMetrics) => void;
}

export interface ModelCallMetric {
  startMs: number;
  firstTokenMs?: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  stopReason: string;
  toolCalls: string[];
}

export interface ToolMetric {
  name: string;
  startMs: number;
  durationMs: number;
  isError: boolean;
}

export interface TurnMetrics {
  totalMs: number;
  /** 第一段非空白正文送出的时间。 */
  firstTokenMs?: number;
  /** 第一条事件（正文、卡片、追问等）送出的时间。 */
  firstEventMs?: number;
  modelCalls: ModelCallMetric[];
  tools: ToolMetric[];
  nudged: boolean;
  error?: string;
}

export interface UserMessage {
  id: string;
  text: string;
  /** 随这条消息发的图片，只在这一轮传给模型。 */
  images?: ChatImage[];
  /** 服务端对图片量出的信息（主要色值等），只拼进本轮给模型的文字，不入历史。 */
  imageNotes?: string[];
}

function promptOf(message: UserMessage): string {
  const notes = message.imageNotes?.filter(Boolean) ?? [];
  return notes.length > 0 ? `${message.text}\n\n[系统附：${notes.join("；")}]` : message.text;
}

function userTurn(user: UserMessage): ChatTurn {
  return {
    id: user.id,
    role: "user",
    content: user.text,
    ...(user.images?.length
      ? { meta: { images: user.images.map(({ id, mimeType }) => ({ id, mimeType })) } }
      : {}),
  };
}

const REPLICA_NUDGE =
  "[系统提示，不是用户发言] 你还没有调用任何样式工具。现在就开始复刻：先 design_resume_style 定下主色、单双栏、抬头和标题样式，再 set_resume_css 补装饰，然后 preview_resume 对照参考图检查。不要再只回复文字。";

/** 复刻参考图要多几轮工具往返（保存、预览、再保存……）。 */
const REPLICA_EXTRA_TURNS = 12;

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

/** ask_user 的问题已经在回复正文里，不回放。 */
const REPLAYED_INTAKE_TOOLS = new Set(["upsert_facts", "skip_field", "complete_section", "resolve_conflict"]);
const REPLAY_RESULT_LIMIT = 400;
/** 「下一个目标」和本轮提问的指引到了之后的轮次已经过时。 */
const TURN_GUIDANCE = /\n?(?:下一个目标：|这一轮的回复)[\s\S]*$/;

function renumberFacts(text: string, kept: number[]): string {
  return text.replace(/第 ([\d、]+) 条/g, (all, list: string) => {
    const mapped = list
      .split("、")
      .map((n) => kept.indexOf(Number(n) - 1))
      .filter((i) => i >= 0)
      .map((i) => i + 1);
    return mapped.length > 0 ? `第 ${mapped.join("、")} 条` : all;
  });
}

/**
 * 建档工具调用落库成历史回放用的记录；没生效的调用（报错、整批被拒）返回 undefined。
 * 被拒的事实从参数里删掉，免得之后的轮次把没写进去的内容当成已记录。
 */
export function replayRecord(
  name: string,
  args: unknown,
  result: string,
  isError: boolean,
): ToolRecord | undefined {
  if (!REPLAYED_INTAKE_TOOLS.has(name)) return undefined;
  const params = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  let text = result.replace(TURN_GUIDANCE, "");
  let kept = params;
  if (name === "upsert_facts") {
    if (!text.startsWith("已写入")) return undefined;
    const [head = "", refused] = text.split(/\n?被拒绝：\n/);
    text = head;
    if (refused !== undefined) {
      const bad = new Set([...refused.matchAll(/^第 (\d+) 条/gm)].map((m) => Number(m[1]) - 1));
      const facts = Array.isArray(params.facts) ? params.facts : [];
      const keep = facts.flatMap((_, i) => (bad.has(i) ? [] : [i]));
      if (keep.length === 0) return undefined;
      kept = { ...params, facts: keep.map((i) => facts[i]) };
      text = renumberFacts(text, keep);
    }
  } else if (isError || (name === "skip_field" && !text.includes("已记下"))) return undefined;
  text = text.trim();
  if (text.length > REPLAY_RESULT_LIMIT) text = `${text.slice(0, REPLAY_RESULT_LIMIT)}…`;
  return { name, args: JSON.parse(JSON.stringify(kept)), result: text };
}

function resultText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] } | undefined)?.content ?? [];
  return content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");
}

/** 回复里第一个问句起算作「下一个问题」，它之前是对用户的回应。 */
export function splitAtQuestion(content: string): { lead: string; tail: string } {
  const sentences = content.match(/[^。！!？?\n]*(?:[。！!？?]+|\n+|$)/g)?.filter(Boolean) ?? [];
  const at = sentences.findIndex((s) => /[？?]\s*$/.test(s.trim()));
  if (at < 0) return { lead: content, tail: "" };
  return { lead: sentences.slice(0, at).join("").trim(), tail: sentences.slice(at).join("").trim() };
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
  const replayTools = (
    records: ToolRecord[],
    prefix: string,
    lead: AssistantMessage["content"] = [],
  ): AgentMessage[] => {
    if (records.length === 0) return lead.length > 0 ? [assistant(lead)] : [];
    const ids = records.map((_, i) => `${prefix}_${i}`);
    const calls = assistant(
      [
        ...lead,
        ...records.map((r, i) => ({
          type: "toolCall" as const,
          id: ids[i] ?? "",
          name: r.name,
          arguments: r.args as never,
        })),
      ],
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
      if (turn.role === "user") {
        const n = turn.meta?.images?.length ?? 0;
        const note =
          n > 0 ? `\n[用户当时随消息发了 ${n} 张图片，现在已不在上下文里；要对照原图请让用户重新发送]` : "";
        return [{ role: "user", content: turn.content + note, timestamp: now }];
      }
      // 回应挂在建档调用之前，首字不被写入拖慢；下一个问题要等「下一个目标」，放在结果之后。岗位工具的正文依赖结果，仍放在前面
      const records = turn.meta?.tools ?? [];
      const intake = records.filter((r) => REPLAYED_INTAKE_TOOLS.has(r.name));
      const jobs = records.filter((r) => !REPLAYED_INTAKE_TOOLS.has(r.name));
      const { lead, tail } =
        intake.length > 0 ? splitAtQuestion(turn.content) : { lead: turn.content, tail: "" };
      const text = lead ? [{ type: "text" as const, text: lead }] : [];
      return [
        ...replayTools(jobs, `hist_${index}`),
        ...replayTools(intake, `hist_${index}_w`, text),
        ...(tail ? [assistant([{ type: "text", text: tail }])] : []),
      ];
    });
}

/** 只认已完成的说法，「简历上写上 GPA 更好」这类建议不算。 */
const CLAIMS_RECORDED =
  /已(?:经)?(?:记(?:下|录|上|好)|写(?:入|进|上|好)|补(?:上|进|好)|录入|保存)|(?:记|写|补|存)(?:下|好|上|到|进|入)(?:来|去)?(?:了|啦|咯)|记录(?:好)?了/;
/** 「样式已保存」说的是外观，不是画像里的内容。 */
const STYLE_WORDS = /样式|风格|颜色|配色|主色|字体|版式|排版|模板|两栏|单栏|标题|抬头/;
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

function nudgeText(subjects: string[], asked: boolean, quiet: boolean): string {
  const what = subjects
    .filter(Boolean)
    .map((s) => `「${s}」`)
    .join("");
  return `[系统提示，不是用户发言] 你在回复里说已经记下${what}，但画像里没有${what ? "这些内容" : "新写入的内容"}（没有调用 upsert_facts 或调用失败）。请现在用 upsert_facts 写入用户上一条消息里对应的信息（quote 逐字摘抄原话）。${stopOrAsk(asked, quiet)}`;
}

function answerNudge(label: string, asked: boolean, quiet: boolean): string {
  return `[系统提示，不是用户发言] 用户上一条在回答${label}，但这一轮没有写入任何内容。里面有能写进简历的（做法、难点、结果等），现在用 upsert_facts 写进对应条目的 highlights（quote 逐字摘抄原话）；用户其实是在说没有或不想说，就用 skip_field。${stopOrAsk(asked, quiet)}`;
}

/** 问不问由代码定：已经问了或这一轮不该问，写完就停；否则按返回的「下一个目标」问一句。 */
function stopOrAsk(asked: boolean, quiet: boolean): string {
  if (asked || quiet) return "写完不要再输出文字，也不要再提问或调用 ask_user。";
  return "写完按返回的「下一个目标」问一句，用 ask_user 发出，不要重复前面的文字。";
}

const REPAIR_TEXT =
  "[系统提示，不是用户发言] 上面 upsert_facts 有条目被拒绝。问题已经发给用户，请按拒绝原因修正后只重新调用 upsert_facts，quote 逐字摘抄用户原话；改不了的就不写。不要再输出文字，也不要再调用 ask_user。";

const CLOSED_REPLIES = [
  "不客气～简历在右侧，想补充或修改随时告诉我。",
  "好的，之后想补充经历或改哪里，随时跟我说。",
  "不客气，祝求职顺利！有要补充的再来找我。",
];

/** 模型没写收尾说法时，由代码补上。 */
function closingLine(thin: boolean): string {
  return `${thin ? "目前能聊的先到这里，简历还比较单薄，简历页有「投递前可以补的东西」。" : "信息已经基本齐了。"}${RESUME_HINT}`;
}

/** 没带问号的请求（「介绍一下自己吧。」）也是在问，代码不再补一句同样的问题。 */
const REQUEST = /说说|说一下|说下|讲讲|讲一下|聊聊|介绍一下|介绍下|告诉我|分享一下|补充一下/;

/** 收尾里指向右侧简历的那句，说过它就算收尾说完了。 */
const RESUME_POINTER = /右侧(?:的)?(?:预览|就是)|(?:可以|直接)导出/;

const isQuestionText = (sentence: string) => /[？?]["”」』）)]*$/.test(sentence.trim());

const SENTENCES = /[^。！!？?\n]*(?:[。！!？?]+|\n+|$)/g;
const ELABORATION = /^(?:比如|例如|譬如|像是?|或者|还是|是不是|或是|你?是?怎么(?:解决|处理|做)的)/;

function resumeText(shown: string): string {
  const seen = shown
    ? `用户只看到了「${shown.slice(-60)}」，后面的内容没有送达。接着往下说，不要重复用户已经看到的话`
    : "用户还没看到你的任何回复，请重新回复";
  return `[系统提示，不是用户发言] 网络中断，你刚才的回复没发完。${seen}；然后照常做完这一轮没做完的事（用 upsert_facts 写入用户刚才说的信息、再问下一个问题），问题已经问出口就不要再问。`;
}

/** 最终还是断了时，存下来的回复只留到最后一个完整句子。 */
function withoutFragment(text: string): string {
  return text.match(/^[\s\S]*[。！？!?…\n]/)?.[0] ?? "";
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
    const startedAt = performance.now();
    const since = () => Math.round(performance.now() - startedAt);
    const modelCalls: ModelCallMetric[] = [];
    const toolMetrics: ToolMetric[] = [];
    const toolStarts = new Map<string, number>();
    let callStart: number | undefined;
    let callFirstToken: number | undefined;
    let firstTokenMs: number | undefined;
    let firstEventMs: number | undefined;
    const queue = new EventQueue();
    const asks: string[] = [];
    // 用户实际看到的正文（被拦下的句子不在里面）和其中的问句数
    let shown = "";
    let questionsShown = 0;
    const changes: ProfileChange[] = [...(turn.seedChanges ?? [])];
    let quickReplies: string[] = [];
    let askedSlot: string | undefined;
    const cards: JobCard[] = [];
    let cardSource: "recommend" | "search" = "recommend";
    let about: JobCard | undefined;
    let tailored: TailorCard | undefined;
    let designs: DesignOption[] | undefined;
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
          if (event.kind === "followup" && questionsShown > 0) {
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
        else if (event.type === "style_options") designs = event.options;
        queue.push(event);
      },
      flags,
      spoken: () => shown + unsent,
      ...(user ? { userText: user.text } : {}),
    };

    if (user && isClosed(state) && isPleasantry(user.text)) {
      const reply = CLOSED_REPLIES[user.text.length % CLOSED_REPLIES.length] ?? "";
      firstTokenMs = since();
      yield { type: "token", text: reply };
      state.history.push(userTurn(user));
      state.history.push({ id: `${turn.id}:reply`, role: "assistant", content: reply });
      deps.onMetrics?.({
        totalMs: since(),
        firstTokenMs,
        firstEventMs: firstTokenMs,
        modelCalls: [],
        tools: [],
        nudged: false,
      });
      yield completenessEvent(state);
      return;
    }

    const replica = Boolean(
      deps.styles?.setCss &&
        deps.styles.preview &&
        (user?.images?.length ||
          state.history.some((t) => t.meta?.tools?.some((r) => r.name === "set_resume_css"))),
    );
    const turnLimit = maxModelTurns + (replica ? REPLICA_EXTRA_TURNS : 0);
    const autoSkipped = user ? skipDeclined(state, user.text) : null;
    const answered = user && !autoSkipped ? answeredSlot(state, user.text) : undefined;
    const completeness = computeCompleteness(state.profile, { completedSections: state.completedSections });
    const target = nextSlotOf(state);
    const designCandidates = deps.styles?.propose
      ? pickDirections({
          text: user?.text ?? "",
          avoid: (await deps.styles.recentDirections?.()) ?? [],
          ...(deps.random && { random: deps.random }),
        })
      : [];
    const systemPrompt = buildSystemPrompt({
      profile: state.profile,
      completeness,
      slot: target,
      closed: isClosed(state),
      ...(autoSkipped ? { autoSkipped } : {}),
      completedSections: state.completedSections,
      conflicts: state.conflicts,
      drafts: state.drafts,
      skipped: state.skipped,
      ...(state.summaries ? { summaries: state.summaries } : {}),
      jobTools: Boolean(deps.jobs),
      tailorTool: Boolean(deps.jobs && deps.tailor),
      styleTool: Boolean(deps.styles),
      designTool: Boolean(deps.styles?.propose),
      designCandidates,
      replica,
      hasImage: Boolean(user?.images?.length),
    });

    let llmError: string | undefined;
    let failures = 0;
    let writeFailures = 0;
    let lastFailedQuote: string | undefined;
    let modelTurns = 0;
    let wrote = false;
    let nudged = false;
    let repaired = false;
    let replicaNudged = false;
    let resumed = false;
    // 正文按整句送出：断流时没说完的半句扣下，不让用户看到
    let unsent = "";
    // 下一步由规划器定：不该问的时候（已收尾、要收尾、刚发了确认）问句拦下，还要问的时候自己写的收尾句拦下，一条回复只留一个问句
    const isQuestion = isQuestionText;
    // 收尾说过一次，这一轮后面的正文不再要：模型常在调用写入之前先收尾，写入返回后又收尾一遍
    let closingShown = false;
    const allowed = (sentence: string): boolean => {
      const plain = sentence.trim();
      if (!plain) return true;
      const plan = planNext(state);
      if (closingShown) return false;
      // 三版缩略图已经摆出来：这一轮只请用户点选，模型顺带追问的建档问题不送出
      if (flags.designs && isQuestion(plain)) return false;
      if (isQuestion(plain)) {
        if (plan.kind !== "ask" || flags.asked) return false;
        return questionsShown === 0 || ELABORATION.test(plain);
      }
      if (plan.kind === "ask") return !wrapsUp(plain);
      if (plan.kind === "wrap" && RESUME_POINTER.test(plain)) closingShown = true;
      return true;
    };
    const sendText = (all: boolean) => {
      const at = all ? unsent.length : Math.max(...[..."。！？!?…\n"].map((c) => unsent.lastIndexOf(c))) + 1;
      if (at <= 0) return;
      const chunk = unsent.slice(0, at);
      unsent = unsent.slice(at);
      let text = "";
      for (const x of chunk.match(SENTENCES) ?? []) {
        if (!x || !allowed(x)) continue;
        if (isQuestion(x)) questionsShown++;
        text += x;
      }
      if (!text) return;
      if (/\S/.test(text)) firstTokenMs ??= since();
      shown += text;
      queue.push({ type: "token", text });
    };
    let broken: { afterText: boolean; inTools: boolean } | undefined;
    let skipDone = false;
    const toolArgs = new Map<string, unknown>();
    const snapshot = () => JSON.stringify([state.profile, state.drafts]);
    const beforeWrite = new Map<string, string>();
    const said = normalizeQuote(user?.text ?? "");
    // 用户没说过的词（「联系方式」「时间线」）是模型的概括，只看这一轮写没写、画像里有没有；用户原话里的具体内容要真在画像里
    const unrecorded = (): string[] => {
      const corpus = normalizeQuote(snapshot());
      return claimedSubjects(shown)
        .filter((s) => !(flags.styled && STYLE_WORDS.test(s)))
        .filter((s) =>
          s && mentioned(said, s) ? !mentioned(corpus, s) : !wrote && !(s && mentioned(corpus, s)),
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
          ...(deps.styles
            ? createStyleTools(ctx, deps.styles, toolLog, {
                replica,
                directions: designCandidates.length > 0,
              })
            : []),
        ],
        messages: historyToMessages(state, deps.model, historyLimit),
      },
      streamFn: (model, context, opts) => {
        callStart = since();
        callFirstToken = undefined;
        return deps.streamFn(model, context, opts);
      },
      toolExecution: "sequential",
      finishTurn: (turn) => {
        if (turn.message.role === "assistant" && turn.message.stopReason === "error") return;
        modelTurns++;
        const calledTool =
          turn.message.role === "assistant" && turn.message.content.some((c) => c.type === "toolCall");
        const stopping = flags.asked || !calledTool;
        const rejected = flags.rejected;
        flags.rejected = false;
        // 收到参考图却只回了一句「我先看看」就停：催一次，让它直接动手
        if (
          replica &&
          user?.images?.length &&
          !flags.jobs &&
          !replicaNudged &&
          failures < 2 &&
          modelTurns < turnLimit
        ) {
          replicaNudged = true;
          agent.steer({ role: "user", content: REPLICA_NUDGE, timestamp: Date.now() });
          return { action: "continue" };
        }
        if (user && stopping && !nudged && failures < 2 && modelTurns < turnLimit) {
          const missed = unrecorded();
          if (missed.length > 0) {
            nudged = true;
            agent.steer({
              role: "user",
              content: nudgeText(missed, flags.asked || questionsShown > 0, planNext(state).kind !== "ask"),
              timestamp: Date.now(),
            });
            return { action: "continue" };
          }
          if (answered && !wrote && !skipDone) {
            nudged = true;
            agent.steer({
              role: "user",
              content: answerNudge(
                answered,
                flags.asked || questionsShown > 0,
                planNext(state).kind !== "ask",
              ),
              timestamp: Date.now(),
            });
            return { action: "continue" };
          }
        }
        // 写入和追问同一次发出时，被拒的条目没有机会改；问题已送出，再给一次只改写入的机会
        if (rejected && flags.asked && !repaired && failures < 2 && modelTurns < turnLimit) {
          repaired = true;
          agent.steer({ role: "user", content: REPAIR_TEXT, timestamp: Date.now() });
          return { action: "continue" };
        }
        if (flags.asked || failures >= 2 || modelTurns >= turnLimit) return { action: "end" };
      },
    });

    agent.subscribe((event) => {
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent.type === "text_delta") {
            if (/\S/.test(event.assistantMessageEvent.delta)) callFirstToken ??= since();
            unsent += event.assistantMessageEvent.delta;
            sendText(false);
          }
          break;
        case "message_end":
          if (event.message.role === "assistant" && event.message.stopReason !== "error") sendText(true);
          if (event.message.role === "assistant") {
            const { usage, content, stopReason } = event.message;
            const start = callStart ?? since();
            modelCalls.push({
              startMs: start,
              ...(callFirstToken !== undefined && { firstTokenMs: callFirstToken }),
              durationMs: since() - start,
              inputTokens: usage.input,
              outputTokens: usage.output,
              cacheReadTokens: usage.cacheRead,
              stopReason,
              toolCalls: content.flatMap((c) => (c.type === "toolCall" ? [c.name] : [])),
            });
            callStart = undefined;
          }
          if (event.message.role === "assistant" && event.message.stopReason === "error") {
            llmError = event.message.errorMessage ?? "unknown error";
            broken = {
              afterText: callFirstToken !== undefined,
              inTools: event.message.content.some((c) => c.type === "toolCall"),
            };
          }
          break;
        case "tool_execution_start":
          toolStarts.set(event.toolCallId, since());
          toolArgs.set(event.toolCallId, event.args);
          if (event.toolName === "upsert_facts") beforeWrite.set(event.toolCallId, snapshot());
          break;
        case "tool_execution_end": {
          const start = toolStarts.get(event.toolCallId) ?? since();
          toolMetrics.push({
            name: event.toolName,
            startMs: start,
            durationMs: since() - start,
            isError: event.isError,
          });
          if (event.toolName === "skip_field" && !event.isError) skipDone = true;
          if (event.toolName === "upsert_facts" && !event.isError) {
            if (beforeWrite.get(event.toolCallId) !== snapshot()) wrote = true;
          }
          const record = replayRecord(
            event.toolName,
            toolArgs.get(event.toolCallId),
            resultText(event.result),
            event.isError,
          );
          if (record) toolLog.push(record);
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
      }
    });

    options.signal?.addEventListener("abort", () => agent.abort(), { once: true });

    // 正文已经送到用户面前后才断流，网关没法整段重试；扣下的半句丢掉，让模型接着已送达的整句往下说并补上写入
    const resumable = () => {
      const kind = llmError && errorKindOf(llmError);
      if (resumed || !broken?.afterText || !kind || !isRetryableKind(kind)) return false;
      if (options.signal?.aborted || modelTurns >= turnLimit) return false;
      return broken.inTools || !(flags.asked || questionsShown > 0);
    };
    const run = (async () => {
      const images = user?.images?.map((i) => ({
        type: "image" as const,
        data: i.data,
        mimeType: i.mimeType,
      }));
      if (images?.length) await agent.prompt(turn.prompt, images);
      else await agent.prompt(turn.prompt);
      if (!resumable()) return;
      resumed = true;
      unsent = "";
      llmError = undefined;
      broken = undefined;
      agent.steer({ role: "user", content: resumeText(shown.trim()), timestamp: Date.now() });
      await agent.continue();
    })()
      .catch((error: unknown) => {
        llmError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => queue.close());

    for await (const event of queue) {
      firstEventMs ??= since();
      yield event;
    }
    await run;
    const report = () =>
      deps.onMetrics?.({
        totalMs: since(),
        ...(firstTokenMs !== undefined && { firstTokenMs }),
        firstEventMs: firstEventMs ?? since(),
        modelCalls,
        tools: toolMetrics,
        nudged,
        ...(llmError && { error: llmError }),
      });

    if (options.signal?.aborted) {
      report();
      return;
    }
    if (!about && cards.length > 0) yield { type: "jobs", source: cardSource, jobs: cards };

    // 问题已经说出口后才卡住的，用户拿到的回复是完整的，不再报错
    const delivered = flags.asked || questionsShown > 0;
    const plan = planNext(state);
    const missed = user && !llmError ? unrecorded() : [];
    const previous = state.history.findLast((t) => t.role === "assistant")?.meta?.clarified;
    const failedWords = lastFailedQuote ?? user?.text ?? "";
    let clarified: string | undefined;
    let closed = false;
    // 收尾由规划器定：该收尾而模型没写收尾说法，代码补上；这一轮刚问了问题就留到下一轮收尾
    if (plan.kind === "wrap" && !llmError && !flags.jobs && !delivered) {
      if (!wrapsUp(shown)) {
        const { tips } = computeCompleteness(state.profile, { completedSections: state.completedSections });
        const line = `${shown && !/\s$/.test(shown) ? "\n" : ""}${closingLine(tips.length > 0)}`;
        shown += line;
        firstTokenMs ??= since();
        yield { type: "token", text: line };
      }
      closed = true;
    }
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
      const question =
        delivered || plan.kind !== "ask"
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
      plan.kind === "ask" &&
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
    } else if (plan.kind === "ask" && !flags.asked && !flags.jobs) {
      // 问哪一项是规划器定的：模型问了就记在这一项上，没问就由代码问
      const { slot } = plan;
      const replies = cleanQuickReplies(slot.replies);
      noteAsked(state, slot);
      askedSlot = slot.key;
      const ref = {
        key: slot.key,
        section: slot.section,
        field: slot.field,
        ...(slot.itemId ? { itemId: slot.itemId } : {}),
      };
      const lastSentence = (shown.match(SENTENCES) ?? []).filter((x) => x.trim()).at(-1) ?? "";
      if (questionsShown === 0 && !REQUEST.test(lastSentence)) {
        const text = slotQuestion(slot);
        asks.push(text);
        yield {
          type: "ask",
          kind: "followup",
          question: text,
          slot: ref,
          ...(replies.length > 0 ? { quickReplies: replies } : {}),
        };
      }
    }

    if (llmError) shown = withoutFragment(shown);
    const reply = [shown.trim(), ...(designs ? [] : asks)].filter(Boolean).join("\n");
    const meta: TurnMeta = {
      ...(changes.length > 0 ? { changes } : {}),
      ...(quickReplies.length > 0 ? { quickReplies } : {}),
      ...(askedSlot ? { slot: askedSlot } : {}),
      ...(clarified ? { clarified } : {}),
      ...(closed ? { closed } : {}),
      ...(about ? { about } : cards.length > 0 ? { jobs: cards } : {}),
      ...(tailored ? { tailor: tailored } : {}),
      ...(designs ? { designs } : {}),
      ...(toolLog.length > 0 ? { tools: about ? withoutCards(toolLog) : toolLog } : {}),
    };
    if (
      !llmError ||
      flags.changed ||
      changes.length > 0 ||
      cards.length > 0 ||
      about ||
      tailored ||
      designs
    ) {
      if (user) state.history.push(userTurn(user));
      if (user || reply || changes.length > 0) {
        state.history.push({
          id: `${turn.id}:reply`,
          role: "assistant",
          content: reply || (user && changes.length > 0 ? "（已记录）" : ""),
          ...(Object.keys(meta).length > 0 ? { meta } : {}),
        });
      }
    }
    report();
    yield completenessEvent(state);
  }

  function handleUserMessage(
    state: IntakeState,
    message: UserMessage,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<IntakeEvent, void> {
    return runTurn(state, { id: message.id, user: message, prompt: promptOf(message) }, options);
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
    const next = planNext(state);
    const tail =
      next.kind === "ask"
        ? "没有新的信息需要写入，请直接用 ask_user 接着问当前目标字段的下一个问题。"
        : next.kind === "wrap"
          ? "没有新的信息需要写入，也没有要问的了，请按「当前目标字段」收尾。"
          : "没有新的信息需要写入，回应一句就结束，不要提问。";
    const prompt = `[系统通知，不是用户发言] 用户确认${label}以「${chosen}」为准，画像已更新。${tail}`;
    yield* runTurn(state, { id, prompt, seedChanges: changes }, options);
  }

  return { handleUserMessage, confirmConflict, resolveConflict: resolveConflictAndContinue };
}
