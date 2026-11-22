import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  type Message,
  type Model,
  normalizeContext,
  type SimpleStreamOptions,
  type Tool,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { GatewayConfig } from "./config.ts";
import {
  classifyErrorMessage,
  describeErrorKind,
  isRetryableKind,
  isUnrecoverableKind,
  type LlmErrorKind,
  LlmGatewayError,
  tagErrorMessage,
  toGatewayError,
} from "./errors.ts";
import { createPiiRedactor, type PiiRedactor } from "./pii.ts";

export const PROVIDER_ID = "talksume-llm";

export interface LlmCallLog {
  purpose: string;
  model: string;
  /** 本次逻辑调用内的第几次请求，从 1 开始。 */
  attempt: number;
  usedFallback: boolean;
  success: boolean;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  errorKind?: LlmErrorKind;
  errorMessage?: string;
  startedAt: number;
}

export type BaseStream = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export type GatewayStreamFn = BaseStream;

export interface GatewayDeps {
  onLog?: (log: LlmCallLog) => void;
  /** 测试注入点，默认走 pi-ai 的 openai-completions 实现。 */
  baseStream?: BaseStream;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** 后台调用的排队参数，测试注入。 */
  priority?: Partial<PriorityOptions>;
}

export interface PriorityOptions {
  /** 前台调用结束后多久内仍算忙：同一轮对话的两次模型调用之间只隔着工具执行。 */
  graceMs: number;
  /** 后台调用最多等这么久，之后照常发出，免得持续有人聊天时永远轮不到。 */
  maxWaitMs: number;
  /** 同时在途的后台调用上限。 */
  concurrency: number;
  pollMs: number;
}

const DEFAULT_PRIORITY: PriorityOptions = { graceMs: 2_000, maxWaitMs: 15_000, concurrency: 2, pollMs: 200 };

/** 同一个 key 并发一多上游首包就变慢，后台调用等前台空闲再发。 */
function createPriorityGate(options: PriorityOptions) {
  let foreground = 0;
  let lastForegroundAt = 0;
  let background = 0;
  const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  return {
    async enter(isBackground: boolean, signal?: AbortSignal): Promise<() => void> {
      if (!isBackground) {
        foreground++;
        return () => {
          foreground--;
          lastForegroundAt = Date.now();
        };
      }
      const deadline = Date.now() + options.maxWaitMs;
      while (
        !signal?.aborted &&
        Date.now() < deadline &&
        (foreground > 0 ||
          Date.now() - lastForegroundAt < options.graceMs ||
          background >= options.concurrency)
      ) {
        await pause(options.pollMs);
      }
      background++;
      return () => {
        background--;
      };
    },
  };
}

export interface CompleteRequest {
  purpose: string;
  system?: string;
  prompt?: string;
  messages?: Message[];
  tools?: Tool[];
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  /** 本次调用每个模型在首次请求之外的重试次数，不传则用配置值。给有自己重试逻辑的调用方快速切到备用模型。 */
  maxRetries?: number;
  /** 不传则按 config.disableThinking。 */
  thinking?: boolean;
  /** 标题、摘要、批量报告这类用户没在等的调用，给正在进行的对话让路。 */
  background?: boolean;
}

export interface StreamTuning {
  maxRetries?: number;
  /** 不传则按 config.disableThinking。 */
  thinking?: boolean;
  background?: boolean;
}

export interface CompleteResult {
  text: string;
  message: AssistantMessage;
  model: string;
}

export interface StructuredRequest<T> extends Omit<CompleteRequest, "tools"> {
  /** JSON Schema，写进提示词约束输出格式。 */
  schema: Record<string, unknown>;
  validate: (value: unknown) => T;
  /** 输出不合规时带着错误让模型重写的次数。 */
  maxRepairs?: number;
}

export interface Gateway {
  readonly config: GatewayConfig;
  readonly primaryModel: Model<Api>;
  readonly fallbackModel: Model<Api>;
  /** 给 pi-agent-core 的 streamFn。purpose 写入调用日志。 */
  streamFn(purpose: string, tuning?: StreamTuning): GatewayStreamFn;
  complete(request: CompleteRequest): Promise<CompleteResult>;
  completeStructured<T>(request: StructuredRequest<T>): Promise<{ value: T; text: string; model: string }>;
}

export function buildModel(
  id: string,
  config: Pick<GatewayConfig, "baseUrl">,
  vision = false,
): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl: config.baseUrl,
    reasoning: false,
    input: vision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    },
  };
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** 只有用户看得见的正文才算已送出；工具调用和调用前的空行先攒着，中途卡住仍可整段重试。 */
function isContentEvent(event: AssistantMessageEvent): boolean {
  return event.type === "thinking_start" || (event.type === "text_delta" && /\S/.test(event.delta));
}

function emptyAssistantMessage(
  model: Model<Api>,
  stopReason: "error" | "aborted",
  errorMessage: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    errorMessage,
    timestamp: Date.now(),
  };
}

const IMAGE_OMITTED = "[图片已省略]";

type Block = { type: string };
const dropImages = <T extends Block>(blocks: T[]): (T | { type: "text"; text: string })[] =>
  blocks.map((b) => (b.type === "image" ? { type: "text" as const, text: IMAGE_OMITTED } : b));

/** 不支持图片的模型：上下文里的图片换成文字占位。 */
export function withoutImages(context: TranscriptContext): TranscriptContext {
  const has = context.messages.some(
    (m) =>
      (m.role === "user" || m.role === "toolResult") &&
      Array.isArray(m.content) &&
      m.content.some((b) => b.type === "image"),
  );
  if (!has) return context;
  return {
    ...context,
    messages: context.messages.map((m) =>
      (m.role === "user" || m.role === "toolResult") && Array.isArray(m.content)
        ? ({ ...m, content: dropImages(m.content as Block[]) } as Message)
        : m,
    ),
  };
}

type Payload = Record<string, unknown>;

/** 同时带上 DeepSeek / 智谱 / Qwen 系的开关，网关会忽略不认识的字段。 */
function withThinkingOff(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return undefined;
  const body = payload as Payload;
  const kwargs = typeof body.chat_template_kwargs === "object" ? body.chat_template_kwargs : {};
  return {
    ...body,
    enable_thinking: false,
    thinking: { type: "disabled" },
    chat_template_kwargs: { ...kwargs, enable_thinking: false },
  };
}

// 匹配报告、简历导入等各自建网关，但打的是同一个上游 key，排队要在进程内共享
const sharedGate = createPriorityGate(DEFAULT_PRIORITY);

export function createGateway(config: GatewayConfig, deps: GatewayDeps = {}): Gateway {
  const primaryModel = buildModel(config.model, config, config.vision);
  // 备用模型是否支持图片不明，一律按纯文本处理
  const fallbackModel = buildModel(config.fallbackModel, config);
  const streams = openAICompletionsApi();
  const baseStream: BaseStream = deps.baseStream ?? ((m, c, o) => streams.streamSimple(m, c, o));
  const sleep = deps.sleep ?? defaultSleep;
  const gate = deps.priority ? createPriorityGate({ ...DEFAULT_PRIORITY, ...deps.priority }) : sharedGate;

  const scrub = (text: string) =>
    (config.apiKey ? text.split(config.apiKey).join("***") : text).slice(0, 500);

  function chainFor(requested: Model<Api>): Model<Api>[] {
    const first = requested.id === fallbackModel.id ? fallbackModel : primaryModel;
    const second = first === primaryModel ? fallbackModel : primaryModel;
    return first.id === second.id ? [first] : [first, second];
  }

  function restoreEvent(
    event: AssistantMessageEvent,
    redactor: PiiRedactor | undefined,
    restorers: Map<number, ReturnType<PiiRedactor["createStreamRestorer"]>>,
    out: AssistantMessageEventStream,
  ): void {
    if (!redactor || redactor.size === 0) {
      out.push(event);
      return;
    }
    const restorerFor = (index: number) => {
      let r = restorers.get(index);
      if (!r) {
        r = redactor.createStreamRestorer();
        restorers.set(index, r);
      }
      return r;
    };
    switch (event.type) {
      case "text_delta":
      case "thinking_delta": {
        const delta = restorerFor(event.contentIndex).push(event.delta);
        out.push({ ...event, delta, partial: redactor.restoreDeep(event.partial) });
        return;
      }
      case "text_end":
      case "thinking_end": {
        const rest = restorers.get(event.contentIndex)?.flush();
        const partial = redactor.restoreDeep(event.partial);
        if (rest) {
          out.push({
            type: event.type === "text_end" ? "text_delta" : "thinking_delta",
            contentIndex: event.contentIndex,
            delta: rest,
            partial,
          });
        }
        out.push({ ...event, content: redactor.restoreText(event.content), partial });
        return;
      }
      case "toolcall_end":
        out.push({
          ...event,
          toolCall: redactor.restoreDeep(event.toolCall),
          partial: redactor.restoreDeep(event.partial),
        });
        return;
      case "done":
        out.push({ ...event, message: redactor.restoreDeep(event.message) });
        return;
      case "error":
        out.push({ ...event, error: redactor.restoreDeep(event.error) });
        return;
      default:
        out.push({ ...event, partial: redactor.restoreDeep(event.partial) });
    }
  }

  async function run(
    purpose: string,
    requested: Model<Api>,
    context: TranscriptContext,
    options: SimpleStreamOptions | undefined,
    out: AssistantMessageEventStream,
    maxRetries: number,
    thinkingOff: boolean,
    background: boolean,
  ): Promise<void> {
    const leave = await gate.enter(background, options?.signal);
    try {
      await attempts(purpose, requested, context, options, out, maxRetries, thinkingOff);
    } finally {
      leave();
    }
  }

  async function attempts(
    purpose: string,
    requested: Model<Api>,
    context: TranscriptContext,
    options: SimpleStreamOptions | undefined,
    out: AssistantMessageEventStream,
    maxRetries: number,
    thinkingOff: boolean,
  ): Promise<void> {
    const redactor = config.redactPii ? createPiiRedactor() : undefined;
    const safeContext = redactor ? redactor.redactDeep(context) : context;
    const chain = chainFor(requested);
    const callerSignal = options?.signal;
    let attempt = 0;
    let last: { kind: LlmErrorKind; text: string; message: AssistantMessage; model: Model<Api> } | undefined;

    const finishError = (
      message: AssistantMessage,
      kind: LlmErrorKind,
      text: string,
      reason: "error" | "aborted",
    ) => {
      const errorMessage = tagErrorMessage(kind, text);
      const restored = redactor ? redactor.restoreDeep(message) : message;
      out.push({ type: "error", reason, error: { ...restored, stopReason: reason, errorMessage } });
    };

    for (const [index, model] of chain.entries()) {
      for (let retry = 0; retry <= maxRetries; retry++) {
        if (callerSignal?.aborted) {
          finishError(
            emptyAssistantMessage(model, "aborted", "aborted"),
            "aborted",
            "请求已被取消",
            "aborted",
          );
          return;
        }
        attempt++;
        const startedAt = Date.now();
        const timeout = new AbortController();
        let timedOut: "total" | "idle" | undefined;
        const timer = setTimeout(() => {
          timedOut = "total";
          timeout.abort();
        }, config.timeoutMs);
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        const touch = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            timedOut ??= "idle";
            timeout.abort();
          }, config.idleTimeoutMs);
        };
        touch();
        const signal = callerSignal ? AbortSignal.any([callerSignal, timeout.signal]) : timeout.signal;

        const buffered: AssistantMessageEvent[] = [];
        const restorers = new Map<number, ReturnType<PiiRedactor["createStreamRestorer"]>>();
        let flushed = false;
        const flush = () => {
          flushed = true;
          for (const event of buffered.splice(0)) restoreEvent(event, redactor, restorers, out);
        };

        let terminal: AssistantMessage | undefined;
        let terminalEvent: AssistantMessageEvent | undefined;
        try {
          const upstream = baseStream(
            model,
            model.input.includes("image") ? safeContext : withoutImages(safeContext),
            {
              ...options,
              apiKey: config.apiKey,
              signal,
              ...(thinkingOff && {
                onPayload: async (payload, m) =>
                  withThinkingOff((await options?.onPayload?.(payload, m)) ?? payload),
              }),
            },
          );
          for await (const event of upstream) {
            touch();
            if (event.type === "done" || event.type === "error") {
              terminalEvent = event;
              terminal = event.type === "done" ? event.message : event.error;
              break;
            }
            if (flushed) restoreEvent(event, redactor, restorers, out);
            else {
              buffered.push(event);
              if (isContentEvent(event)) flush();
            }
          }
          terminal ??= await upstream.result();
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          terminal = emptyAssistantMessage(model, "error", text);
        } finally {
          clearTimeout(timer);
          clearTimeout(idleTimer);
        }

        const durationMs = Date.now() - startedAt;
        const log = (success: boolean, kind?: LlmErrorKind, text?: string) =>
          deps.onLog?.({
            purpose,
            model: model.id,
            attempt,
            usedFallback: index > 0,
            success,
            durationMs,
            inputTokens: terminal?.usage.input ?? 0,
            outputTokens: terminal?.usage.output ?? 0,
            totalTokens: terminal?.usage.totalTokens ?? 0,
            ...(kind ? { errorKind: kind } : {}),
            ...(text ? { errorMessage: text } : {}),
            startedAt,
          });

        if (terminal.stopReason !== "error" && terminal.stopReason !== "aborted") {
          log(true);
          flush();
          restoreEvent(
            terminalEvent ?? {
              type: "done",
              reason: terminal.stopReason === "toolUse" ? "toolUse" : "stop",
              message: terminal,
            },
            redactor,
            restorers,
            out,
          );
          return;
        }

        if (terminal.stopReason === "aborted" && !timedOut) {
          log(false, "aborted", "aborted");
          flush();
          finishError(terminal, "aborted", terminal.errorMessage ?? "请求已被取消", "aborted");
          return;
        }

        const raw = scrub(
          timedOut === "idle"
            ? `响应中断（${config.idleTimeoutMs}ms 无数据）`
            : timedOut
              ? `请求超时（${config.timeoutMs}ms）`
              : (terminal.errorMessage ?? "unknown error"),
        );
        const kind: LlmErrorKind = timedOut ? "timeout" : classifyErrorMessage(raw);
        log(false, kind, raw);
        last = { kind, text: raw, message: terminal, model };

        if (flushed) {
          finishError(terminal, kind, describeErrorKind(kind), "error");
          return;
        }
        if (isUnrecoverableKind(kind)) {
          finishError(terminal, kind, describeErrorKind(kind), "error");
          return;
        }
        if (isRetryableKind(kind) && retry < maxRetries) {
          // 超时和断连换一条连接立刻重来就行，退避只对限流和 5xx 有意义
          if (kind !== "timeout" && kind !== "network") {
            await sleep(config.retryBaseDelayMs * 2 ** retry, callerSignal);
          }
          continue;
        }
        break;
      }
    }

    if (last) {
      const suffix =
        chain.length > 1 ? `，主备模型共尝试 ${attempt} 次均失败` : `，共尝试 ${attempt} 次均失败`;
      finishError(last.message, last.kind, `${describeErrorKind(last.kind)}${suffix}`, "error");
    }
  }

  function streamFn(purpose: string, tuning: StreamTuning = {}): GatewayStreamFn {
    const thinkingOff = tuning.thinking === undefined ? config.disableThinking : !tuning.thinking;
    return (model, context, options) => {
      const out = createAssistantMessageEventStream();
      run(
        purpose,
        model,
        context,
        options,
        out,
        tuning.maxRetries ?? config.maxRetries,
        thinkingOff,
        tuning.background ?? false,
      ).catch((error) => {
        const text = error instanceof Error ? error.message : String(error);
        out.push({
          type: "error",
          reason: "error",
          error: {
            ...emptyAssistantMessage(model, "error", ""),
            errorMessage: tagErrorMessage("unknown", scrub(text)),
          },
        });
      });
      return out;
    };
  }

  async function complete(request: CompleteRequest): Promise<CompleteResult> {
    const messages: Message[] = request.messages ?? [
      { role: "user", content: request.prompt ?? "", timestamp: Date.now() },
    ];
    const context = normalizeContext({
      ...(request.system ? { systemPrompt: request.system } : {}),
      messages,
      ...(request.tools ? { tools: request.tools } : {}),
    });
    const options: SimpleStreamOptions = {
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    };
    const tuning: StreamTuning = {
      ...(request.maxRetries !== undefined && { maxRetries: request.maxRetries }),
      ...(request.thinking !== undefined && { thinking: request.thinking }),
      ...(request.background && { background: true }),
    };
    const message = await streamFn(request.purpose, tuning)(primaryModel, context, options).result();
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      throw toGatewayError(message.errorMessage ?? "模型调用失败", message.model);
    }
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { text, message, model: message.model };
  }

  async function completeStructured<T>(request: StructuredRequest<T>) {
    const system = [
      request.system,
      "只输出一个符合下面 JSON Schema 的 JSON 对象，不要输出解释、前后缀或 Markdown 代码块。",
      JSON.stringify(request.schema),
    ]
      .filter(Boolean)
      .join("\n\n");
    const messages: Message[] = request.messages
      ? [...request.messages]
      : [{ role: "user", content: request.prompt ?? "", timestamp: Date.now() }];
    const maxRepairs = request.maxRepairs ?? 1;
    let lastProblem = "";
    for (let round = 0; round <= maxRepairs; round++) {
      const result = await complete({
        purpose: request.purpose,
        system,
        messages,
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
        ...(request.maxRetries !== undefined ? { maxRetries: request.maxRetries } : {}),
        ...(request.thinking !== undefined ? { thinking: request.thinking } : {}),
        ...(request.background && { background: true }),
        temperature: request.temperature ?? 0,
      });
      try {
        const value = request.validate(extractJson(result.text));
        return { value, text: result.text, model: result.model };
      } catch (error) {
        lastProblem = error instanceof Error ? error.message : String(error);
        messages.push(result.message, {
          role: "user",
          content: `上一次输出不合规：${lastProblem.slice(0, 600)}\n请只输出修正后的 JSON。`,
          timestamp: Date.now(),
        });
      }
    }
    throw new LlmGatewayError("invalid_output", `结构化输出校验失败：${lastProblem}`, config.model);
  }

  return { config, primaryModel, fallbackModel, streamFn, complete, completeStructured };
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  throw new Error("输出不是合法 JSON");
}
