import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  createFauxCore,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  normalizeContext,
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
