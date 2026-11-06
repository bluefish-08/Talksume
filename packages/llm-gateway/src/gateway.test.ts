import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  createFauxCore,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type Model,
  normalizeContext,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { loadGatewayConfig } from "./config.ts";
import { LlmAuthError, LlmGatewayError, LlmQuotaExceededError } from "./errors.ts";
import { createGateway, type LlmCallLog } from "./gateway.ts";
import { createPiiRedactor } from "./pii.ts";

const baseEnv = { LLM_BASE_URL: "http://llm.test/v1", LLM_API_KEY: "sk-test-secret" };

function setup(
  script: (call: number, model: string, text: string) => AssistantMessage | string,
  overrides = {},
) {
  const core = createFauxCore({ models: [{ id: "deepseek-v4.1-flash" }, { id: "glm-5.3" }] });
  const calls: { model: string; text: string }[] = [];
  const factory: FauxResponseFactory = (context, _options, _state, model) => {
    const text = JSON.stringify(context.messages);
    calls.push({ model: model.id, text });
    const result = script(calls.length, model.id, text);
    return typeof result === "string" ? fauxAssistantMessage(result) : result;
  };
  const logs: LlmCallLog[] = [];
  const sleeps: number[] = [];
  const gateway = createGateway(loadGatewayConfig(baseEnv, overrides), {
    baseStream: (m, c, o) => core.streamSimple(m, c, o),
    onLog: (l) => logs.push(l),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  core.setResponses(Array.from({ length: 20 }, () => factory));
  return { gateway, calls, logs, sleeps };
}

const err = (message: string) => fauxAssistantMessage([], { stopReason: "error", errorMessage: message });

describe("loadGatewayConfig", () => {
  it("applies default models", () => {
    const config = loadGatewayConfig(baseEnv);
    expect(config.model).toBe("deepseek-v4.1-flash");
    expect(config.fallbackModel).toBe("glm-5.3");
    expect(config.maxRetries).toBe(3);
  });

  it("reads overrides from env and rejects missing credentials", () => {
    expect(loadGatewayConfig({ ...baseEnv, LLM_MODEL: "a", LLM_FALLBACK_MODEL: "b" }).fallbackModel).toBe(
      "b",
    );
    expect(() => loadGatewayConfig({ LLM_BASE_URL: "x" })).toThrow(/LLM_API_KEY/);
  });
});

describe("disableThinking", () => {
  async function payloadSeenBy(env: Record<string, string>, thinking?: boolean) {
    const core = createFauxCore({ models: [{ id: "deepseek-v4.1-flash" }] });
    core.setResponses([fauxAssistantMessage("ok")]);
    let hook: ((payload: unknown, model: never) => unknown) | undefined;
    const gateway = createGateway(loadGatewayConfig({ ...baseEnv, ...env }), {
      baseStream: (m, c, o) => {
        hook = o?.onPayload as typeof hook;
        return core.streamSimple(m, c, o);
      },
    });
    await gateway.complete({ purpose: "p", prompt: "hi", ...(thinking !== undefined && { thinking }) });
    return hook?.({ model: "x", chat_template_kwargs: { a: 1 } }, undefined as never);
  }

  it("默认在请求体里关闭思考，并保留已有字段", async () => {
    expect(await payloadSeenBy({})).toEqual({
      model: "x",
      enable_thinking: false,
      thinking: { type: "disabled" },
      chat_template_kwargs: { a: 1, enable_thinking: false },
    });
  });

  it("LLM_DISABLE_THINKING=0 时不改请求体", async () => {
    expect(await payloadSeenBy({ LLM_DISABLE_THINKING: "0" })).toBeUndefined();
  });

  it("complete 的 thinking 覆盖全局配置", async () => {
    expect(await payloadSeenBy({ LLM_DISABLE_THINKING: "0" }, false)).toMatchObject({
      enable_thinking: false,
    });
  });

  async function hookFor(env: Record<string, string>, thinking: boolean) {
    const core = createFauxCore({ models: [{ id: "deepseek-v4.1-flash" }] });
    core.setResponses([fauxAssistantMessage("ok")]);
    let hook: unknown;
    const gateway = createGateway(loadGatewayConfig({ ...baseEnv, ...env }), {
      baseStream: (m, c, o) => {
        hook = o?.onPayload;
        return core.streamSimple(m, c, o);
      },
    });
    const context = normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 0 }] });
    await gateway.streamFn("intake", { thinking })(gateway.primaryModel, context).result();
    return hook;
  }

  it("streamFn 的 thinking 覆盖全局配置", async () => {
    expect(await hookFor({}, true)).toBeUndefined();
    expect(await hookFor({ LLM_DISABLE_THINKING: "0" }, false)).toBeTypeOf("function");
  });

  it("completeStructured 的 thinking 覆盖全局配置", async () => {
    const core = createFauxCore({ models: [{ id: "deepseek-v4.1-flash" }] });
    core.setResponses([fauxAssistantMessage('{"n":1}')]);
    let hook: unknown;
    const gateway = createGateway(loadGatewayConfig({ ...baseEnv, LLM_DISABLE_THINKING: "0" }), {
      baseStream: (m, c, o) => {
        hook = o?.onPayload;
        return core.streamSimple(m, c, o);
      },
    });
    await gateway.completeStructured({
      purpose: "memory",
      prompt: "x",
      schema: {},
      validate: (v) => v,
      thinking: false,
    });
    expect(hook).toBeTypeOf("function");
  });
});

describe("pii redactor", () => {
  it("replaces phones and emails consistently and restores them", () => {
    const r = createPiiRedactor();
    const text = "手机 138-1234-5678，邮箱 a.b@example.com，再说一次 13812345678";
    const redacted = r.redactText(text);
    expect(redacted).not.toMatch(/1381|@example/);
    expect(redacted).toContain("[PHONE_1]");
    expect(redacted.match(/\[PHONE_\d\]/g)).toEqual(["[PHONE_1]", "[PHONE_2]"]);
    expect(r.restoreText(redacted)).toBe(text);
  });

  it("restores placeholders split across stream deltas", () => {
    const r = createPiiRedactor();
    r.redactText("13812345678");
    const s = r.createStreamRestorer();
    const out = ["号码是[PHO", "NE_", "1]。", "好"].map((d) => s.push(d)).join("") + s.flush();
    expect(out).toBe("号码是13812345678。好");
  });

  it("does not touch protocol keys deeply", () => {
    const r = createPiiRedactor();
    const value = { role: "user", content: [{ type: "text", text: "mail me: x@y.com" }] };
    expect(JSON.stringify(r.redactDeep(value))).toContain("[EMAIL_1]");
    expect(r.redactDeep(value).role).toBe("user");
  });
});

describe("gateway retry and fallback", () => {
  it("retries 429 with exponential backoff then succeeds", async () => {
    const { gateway, logs, sleeps } = setup((n) => (n < 3 ? err("429 Too Many Requests") : "你好"));
    const result = await gateway.complete({ purpose: "chat", prompt: "hi" });
    expect(result.text).toBe("你好");
    expect(sleeps).toEqual([500, 1000]);
    expect(logs.map((l) => [l.attempt, l.success, l.errorKind])).toEqual([
      [1, false, "rate_limited"],
      [2, false, "rate_limited"],
      [3, true, undefined],
    ]);
    expect(logs.every((l) => l.purpose === "chat" && !l.usedFallback)).toBe(true);
  });

  it("switches to the fallback model after exhausting retries on the primary", async () => {
    const { gateway, calls, logs, sleeps } = setup((_n, model) =>
      model === "glm-5.3" ? "备用回答" : err("503 service unavailable"),
    );
    const result = await gateway.complete({ purpose: "chat", prompt: "hi" });
    expect(result.text).toBe("备用回答");
    expect(calls.map((c) => c.model)).toEqual([
      "deepseek-v4.1-flash",
      "deepseek-v4.1-flash",
      "deepseek-v4.1-flash",
      "deepseek-v4.1-flash",
      "glm-5.3",
    ]);
    expect(sleeps).toEqual([500, 1000, 2000]);
    expect(logs.at(-1)).toMatchObject({ model: "glm-5.3", usedFallback: true, success: true });
  });

  it("maxRetries per request lets slow primary failures fall back immediately", async () => {
    const { gateway, calls, sleeps } = setup((_n, model) =>
      model === "glm-5.3" ? "备用回答" : err("Request timed out."),
    );
    const result = await gateway.complete({ purpose: "match_report", prompt: "hi", maxRetries: 0 });
    expect(result.text).toBe("备用回答");
    expect(calls.map((c) => c.model)).toEqual(["deepseek-v4.1-flash", "glm-5.3"]);
    expect(sleeps).toEqual([]);
  });

  it("puts the requested fallback model first and keeps the primary as backup", async () => {
    const { gateway, calls } = setup(
      (_n, model) => (model === "glm-5.3" ? err("503 service unavailable") : "主模型兜底"),
      { maxRetries: 0 },
    );
    const context = normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 0 }] });
    const message = await gateway.streamFn("intake")(gateway.fallbackModel, context).result();
    expect(message.content).toEqual([{ type: "text", text: "主模型兜底" }]);
    expect(calls.map((c) => c.model)).toEqual(["glm-5.3", "deepseek-v4.1-flash"]);
  });

  it("fails with the last error when both models are down", async () => {
    const { gateway, calls } = setup(() => err("500 internal server error"), { maxRetries: 1 });
    await expect(gateway.complete({ purpose: "chat", prompt: "hi" })).rejects.toMatchObject({
      kind: "server",
    });
    expect(calls).toHaveLength(4);
  });

  it("throws a recognizable error without retrying on quota exhaustion", async () => {
    const { gateway, calls, logs } = setup(() =>
      err('429 {"error":{"code":"API_KEY_TOKEN_BUDGET_EXCEEDED","message":"budget exhausted"}}'),
    );
    const failure = gateway.complete({ purpose: "chat", prompt: "hi" });
    await expect(failure).rejects.toBeInstanceOf(LlmQuotaExceededError);
    await expect(failure).rejects.toMatchObject({ kind: "quota_exhausted" });
    expect(calls).toHaveLength(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ success: false, errorKind: "quota_exhausted" });
  });

  it("treats insufficient_quota and auth failures as unrecoverable", async () => {
    const quota = setup(() => err("insufficient_quota: You exceeded your current quota"));
    await expect(quota.gateway.complete({ purpose: "p", prompt: "x" })).rejects.toBeInstanceOf(
      LlmQuotaExceededError,
    );
    expect(quota.calls).toHaveLength(1);
    const auth = setup(() => err("401 invalid api key"));
    await expect(auth.gateway.complete({ purpose: "p", prompt: "x" })).rejects.toBeInstanceOf(LlmAuthError);
  });

  it("does not retry on invalid requests but tries the fallback model", async () => {
    const { gateway, calls } = setup((_n, model) =>
      model === "glm-5.3" ? "ok" : err("400 invalid_request_error"),
    );
    expect((await gateway.complete({ purpose: "p", prompt: "x" })).text).toBe("ok");
    expect(calls.map((c) => c.model)).toEqual(["deepseek-v4.1-flash", "glm-5.3"]);
  });

  it("times out a hanging request and treats it as retryable", async () => {
    const logs: LlmCallLog[] = [];
    const gateway = createGateway(
      loadGatewayConfig(baseEnv, { timeoutMs: 20, maxRetries: 1, retryBaseDelayMs: 1 }),
      {
        baseStream: (model, _context, options) => {
          const stream = createAssistantMessageEventStream();
          options?.signal?.addEventListener("abort", () => {
            const message: AssistantMessage = {
              ...fauxAssistantMessage([], { stopReason: "aborted" }),
              model: model.id,
            };
            stream.push({ type: "error", reason: "aborted", error: message });
          });
          return stream;
        },
        onLog: (l) => logs.push(l),
      },
    );
    await expect(gateway.complete({ purpose: "p", prompt: "x" })).rejects.toMatchObject({ kind: "timeout" });
    expect(logs).toHaveLength(4);
    expect(logs.every((l) => l.errorKind === "timeout")).toBe(true);
  });

  const silentThenOk = (prefix: (stream: AssistantMessageEventStream) => void) => {
    const core = createFauxCore({ models: [{ id: "deepseek-v4.1-flash" }, { id: "glm-5.3" }] });
    core.setResponses([fauxAssistantMessage("好的")]);
    let calls = 0;
    return (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => {
      if (++calls > 1) return core.streamSimple(model, context, options);
      const stream = createAssistantMessageEventStream();
      prefix(stream);
      options?.signal?.addEventListener("abort", () => {
        const message: AssistantMessage = {
          ...fauxAssistantMessage([], { stopReason: "aborted" }),
          model: model.id,
        };
        stream.push({ type: "error", reason: "aborted", error: message });
      });
      return stream;
    };
  };

  it("一直没有数据时按空闲时限断开，立刻重试不退避", async () => {
    const logs: LlmCallLog[] = [];
    const sleeps: number[] = [];
    const gateway = createGateway(
      loadGatewayConfig(baseEnv, { timeoutMs: 60_000, idleTimeoutMs: 20, maxRetries: 1 }),
      {
        baseStream: silentThenOk(() => {}),
        onLog: (l) => logs.push(l),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    const started = Date.now();
    const result = await gateway.complete({ purpose: "p", prompt: "x" });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.text).toBe("好的");
    expect(logs.map((l) => l.errorKind ?? "ok")).toEqual(["timeout", "ok"]);
    expect(logs[0]?.errorMessage).toContain("无数据");
    expect(sleeps).toEqual([]);
  });

  it("只出了空行就卡住仍按未送出处理，空闲超时后整段重试", async () => {
    const logs: LlmCallLog[] = [];
    const partial = fauxAssistantMessage([]);
    const gateway = createGateway(
      loadGatewayConfig(baseEnv, { timeoutMs: 60_000, idleTimeoutMs: 20, maxRetries: 1 }),
      {
        baseStream: silentThenOk((stream) => {
          stream.push({ type: "start", partial });
          stream.push({ type: "text_start", contentIndex: 0, partial });
          stream.push({ type: "text_delta", contentIndex: 0, delta: "\n\n", partial });
        }),
        onLog: (l) => logs.push(l),
      },
    );
    const deltas: string[] = [];
    const stream = gateway.streamFn("p")(
      gateway.primaryModel,
      normalizeContext({ messages: [{ role: "user", content: "x", timestamp: 0 }] }),
    );
    for await (const event of stream) if (event.type === "text_delta") deltas.push(event.delta);
    const message = await stream.result();
    expect(message.stopReason).toBe("stop");
    expect(deltas.join("")).toBe("好的");
    expect(logs.map((l) => l.errorKind ?? "ok")).toEqual(["timeout", "ok"]);
    expect(logs[0]?.errorMessage).toContain("无数据");
  });

  it("后台调用等前台调用结束才发出", async () => {
    const core = createFauxCore({ models: [{ id: "deepseek-v4.1-flash" }] });
    core.setResponses([fauxAssistantMessage("前台"), fauxAssistantMessage("后台")]);
    const started: string[] = [];
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gateway = createGateway(loadGatewayConfig(baseEnv), {
      priority: { graceMs: 0, maxWaitMs: 5_000, pollMs: 5 },
      baseStream: (model, context, options) => {
        const label = JSON.stringify(context.messages).includes("前台") ? "fg" : "bg";
        started.push(label);
        if (label !== "fg") return core.streamSimple(model, context, options);
        const out = createAssistantMessageEventStream();
        void hold.then(async () => {
          for await (const event of core.streamSimple(model, context, options)) out.push(event);
        });
        return out;
      },
    });
    const foreground = gateway.complete({ purpose: "intake", prompt: "前台" });
    const background = gateway.complete({ purpose: "title", prompt: "后台", background: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(started).toEqual(["fg"]);
    release();
    expect((await foreground).text).toBe("前台");
    expect((await background).text).toBe("后台");
    expect(started).toEqual(["fg", "bg"]);
  });

  it("propagates caller aborts without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    const { gateway, calls } = setup(() => "never");
    await expect(
      gateway.complete({ purpose: "p", prompt: "x", signal: controller.signal }),
    ).rejects.toMatchObject({
      kind: "aborted",
    });
    expect(calls).toHaveLength(0);
  });

  it("records token usage in the call log", async () => {
    const { gateway, logs } = setup(() => "一段比较长的回答文本，用来产生非零的 token 估算值。");
    await gateway.complete({ purpose: "usage", prompt: "hello" });
    expect(logs[0]?.totalTokens).toBeGreaterThan(0);
    expect(logs[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("never leaks the api key into logs or errors", async () => {
    const { gateway, logs } = setup(() => err("401 bad key sk-test-secret"));
    const failure = await gateway.complete({ purpose: "p", prompt: "x" }).catch((e: Error) => e);
    expect((failure as Error).message).not.toContain("sk-test-secret");
    expect(JSON.stringify(logs)).not.toContain("sk-test-secret");
  });
});

describe("gateway PII handling", () => {
  it("sends placeholders to the model and restores them in the result", async () => {
    const { gateway, calls } = setup((_n, _m, text) => {
      expect(text).not.toContain("13812345678");
      expect(text).not.toContain("zhang@example.com");
      return "已记录 [PHONE_1] 和 [EMAIL_1]";
    });
    const result = await gateway.complete({
      purpose: "p",
      prompt: "我的手机 13812345678，邮箱 zhang@example.com",
    });
    expect(result.text).toBe("已记录 13812345678 和 zhang@example.com");
    expect(calls[0]?.text).toContain("[PHONE_1]");
  });

  it("restores placeholders inside streamed text and tool call arguments", async () => {
    const { gateway } = setup(() =>
      fauxAssistantMessage([fauxText("电话是 [PHONE_1]"), fauxToolCall("upsert", { phone: "[PHONE_1]" })], {
        stopReason: "toolUse",
      }),
    );
    const context = normalizeContext({
      messages: [{ role: "user", content: "我的手机号 13812345678", timestamp: Date.now() }],
    });
    const stream = gateway.streamFn("chat")(gateway.primaryModel, context);
    let text = "";
    for await (const event of stream) if (event.type === "text_delta") text += event.delta;
    const message = await stream.result();
    expect(text).toBe("电话是 13812345678");
    const call = message.content.find((b) => b.type === "toolCall");
    expect(call && "arguments" in call ? call.arguments : null).toEqual({ phone: "13812345678" });
  });

  it("can be switched off", async () => {
    const { gateway, calls } = setup(() => "ok", { redactPii: false });
    await gateway.complete({ purpose: "p", prompt: "13812345678" });
    expect(calls[0]?.text).toContain("13812345678");
  });
});

describe("completeStructured", () => {
  const validate = (value: unknown) => {
    if (typeof value !== "object" || value === null || typeof (value as { n?: unknown }).n !== "number") {
      throw new Error("n 必须是数字");
    }
    return value as { n: number };
  };

  it("parses JSON wrapped in a code fence", async () => {
    const { gateway } = setup(() => '```json\n{"n": 3}\n```');
    const out = await gateway.completeStructured({
      purpose: "s",
      prompt: "x",
      schema: { type: "object" },
      validate,
    });
    expect(out.value).toEqual({ n: 3 });
  });

  it("asks the model to repair invalid output once", async () => {
    const { gateway, calls } = setup((n) => (n === 1 ? '{"n": "three"}' : '{"n": 3}'));
    const out = await gateway.completeStructured({
      purpose: "s",
      prompt: "x",
      schema: { type: "object" },
      validate,
    });
    expect(out.value.n).toBe(3);
    expect(calls[1]?.text).toContain("n 必须是数字");
  });

  it("throws invalid_output when repair also fails", async () => {
    const { gateway } = setup(() => "not json");
    const failure = gateway.completeStructured({ purpose: "s", prompt: "x", schema: {}, validate });
    await expect(failure).rejects.toBeInstanceOf(LlmGatewayError);
    await expect(failure).rejects.toMatchObject({ kind: "invalid_output" });
  });
});

describe("图片输入", () => {
  const png = "iVBORw0KGgo13800138000AAAANSUhEUgAA";
  const messages = [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "照这张做" },
        { type: "image" as const, data: png, mimeType: "image/png" },
      ],
      timestamp: 1,
    },
  ];

  it("主模型收到原图，base64 不被手机号脱敏改写", async () => {
    const { gateway, calls } = setup(() => "好的");
    await gateway.complete({ purpose: "p", messages });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain(png);
  });

  it("主模型失败切到备用模型时，图片换成文字占位", async () => {
    const { gateway, calls } = setup((n) => (n <= 4 ? err("503 busy") : "好的"));
    await gateway.complete({ purpose: "p", messages });
    const fallback = calls.filter((c) => c.model === "glm-5.3");
    expect(fallback.length).toBeGreaterThan(0);
    for (const c of fallback) {
      expect(c.text).not.toContain(png);
      expect(c.text).toContain("[图片已省略]");
    }
    expect(calls.some((c) => c.model === "deepseek-v4.1-flash" && c.text.includes(png))).toBe(true);
  });

  it("LLM_VISION=0 时主模型也不收图", async () => {
    const core = createFauxCore({ models: [{ id: "deepseek-v4.1-flash" }] });
    let seen = "";
    core.setResponses([
      (context) => {
        seen = JSON.stringify(context.messages);
        return fauxAssistantMessage("ok");
      },
    ]);
    const gateway = createGateway(loadGatewayConfig({ ...baseEnv, LLM_VISION: "0" }), {
      baseStream: (m, c, o) => core.streamSimple(m, c, o),
    });
    await gateway.complete({ purpose: "p", messages });
    expect(seen).not.toContain(png);
  });
});
