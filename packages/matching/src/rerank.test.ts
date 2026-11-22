import { LlmGatewayError, LlmUnrecoverableError } from "@talksume/llm-gateway";
import { describe, expect, it } from "vitest";
import { makeJob, makeProfile } from "./fixtures.ts";
import { buildScoreContext, scoreJob } from "./pipeline.ts";
import {
  buildRerankPrompt,
  generateReport,
  generateReports,
  REPORT_MAX_TOKENS,
  type StructuredLlm,
} from "./rerank.ts";

type Req = Parameters<StructuredLlm["completeStructured"]>[0];

const profile = makeProfile({
  education: [
    { id: "e1", school: "同济大学", degree: "bachelor", major: "软件工程", end: "2022-06" },
    { id: "e2", school: "浙江大学", degree: "master", major: "计算机科学", end: "2025-06" },
  ],
  skills: ["Go", "Redis"].map((name, i) => ({ id: `s${i}`, name })),
});
const jobs = Array.from({ length: 6 }, (_, i) =>
  makeJob({ id: `j${i}`, title: `后端开发${i}`, jdText: `熟悉Go和Redis。${"负责服务开发。".repeat(400)}` }),
);
const ctx = buildScoreContext(jobs);
const ranked = jobs.map((j) => scoreJob(profile, j, ctx));
const ok = (req: Req) => {
  const value = req.validate({ summary: "匹配", strengths: ["a"], gaps: ["b"] });
  return { value, text: "", model: "fake" } as { value: never; text: string; model: string };
};

/** 不响应，直到调用方的超时信号触发，模拟推理模型卡住。 */
const hang = (req: Req) =>
  new Promise<never>((_, reject) => {
    req.signal?.addEventListener("abort", () => reject(new Error("请求已被取消")));
  });

describe("报告提示词", () => {
  it("教育按最高学历在前，JD 截断，只带必要的证据", () => {
    const prompt = buildRerankPrompt(profile, ranked[0] as (typeof ranked)[number]);
    expect(prompt.indexOf("浙江大学")).toBeLessThan(prompt.indexOf("同济大学"));
    expect(prompt.length).toBeLessThan(3500);
  });

  it("实习只有 highlights 没有 bullets 时，要点也进画像", () => {
    const p = makeProfile({
      experiences: [
        {
          id: "e1",
          kind: "internship",
          company: "腾讯",
          title: "后台开发",
          bullets: [],
          highlights: [{ title: "核销重构", detail: "P99 从 300ms 降至 80ms" }],
        },
      ],
    });
    const prompt = buildRerankPrompt(p, ranked[0] as (typeof ranked)[number]);
    expect(prompt).toContain("核销重构：P99 从 300ms 降至 80ms");
  });
});

describe("报告生成：超时、重试、并发", () => {
  const fast = { retryDelayMs: 0, attemptTimeoutMs: 40 };

  it("请求带上 max_tokens 和单次时限信号", async () => {
    let seen: Req | undefined;
    const llm: StructuredLlm = {
      completeStructured: async (req) => {
        seen = req;
        return ok(req) as never;
      },
    };
    await generateReport(llm, profile, ranked[0] as (typeof ranked)[number]);
    expect(seen?.maxTokens).toBe(REPORT_MAX_TOKENS);
    expect(seen?.maxRetries).toBe(1);
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it("第一次卡住超时后重发一次，第二次成功即返回", async () => {
    let calls = 0;
    const llm: StructuredLlm = {
      completeStructured: (async (req: Req) => (++calls === 1 ? hang(req) : ok(req))) as never,
    };
    const res = await generateReport(llm, profile, ranked[0] as (typeof ranked)[number], fast);
    expect(res.report.summary).toBe("匹配");
    expect(calls).toBe(2);
  });

  it("两次都超时则抛出带超时说明的错误，不无限等待", async () => {
    let calls = 0;
    const llm: StructuredLlm = {
      completeStructured: (async (req: Req) => {
        calls++;
        return hang(req);
      }) as never,
    };
    const started = Date.now();
    await expect(generateReport(llm, profile, ranked[0] as (typeof ranked)[number], fast)).rejects.toThrow(
      "超时",
    );
    expect(calls).toBe(2);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("额度/鉴权类不可恢复错误不重试", async () => {
    let calls = 0;
    const llm: StructuredLlm = {
      completeStructured: (async () => {
        calls++;
        throw new LlmUnrecoverableError("quota_exhausted", "no quota");
      }) as never,
    };
    await expect(generateReport(llm, profile, ranked[0] as (typeof ranked)[number], fast)).rejects.toThrow(
      "no quota",
    );
    expect(calls).toBe(1);
    const other: StructuredLlm = {
      completeStructured: (async () => {
        calls++;
        throw new LlmGatewayError("server", "502");
      }) as never,
    };
    await expect(generateReport(other, profile, ranked[0] as (typeof ranked)[number], fast)).rejects.toThrow(
      "502",
    );
    expect(calls).toBe(3);
  });

  it("并发不超过上限，结果逐个回调，失败只影响自己", async () => {
    let inFlight = 0;
    let peak = 0;
    const seenPrompts: string[] = [];
    const llm: StructuredLlm = {
      completeStructured: (async (req: Req) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        const prompt = req.prompt ?? "";
        if (!seenPrompts.includes(prompt)) seenPrompts.push(prompt);
        if (seenPrompts.indexOf(prompt) === 1) throw new Error("boom");
        return ok(req);
      }) as never,
    };
    const reported: string[] = [];
    const failed: string[] = [];
    const reports = await generateReports(llm, profile, ranked, {
      topN: 6,
      concurrency: 2,
      attempts: 1,
      onReport: (r) => {
        reported.push(r.jobId);
      },
      onError: (_e, id) => {
        failed.push(id);
      },
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(reports).toHaveLength(5);
    expect(reported).toHaveLength(5);
    expect(failed).toHaveLength(1);
  });

  it("默认并发为 3", async () => {
    let inFlight = 0;
    let peak = 0;
    const llm: StructuredLlm = {
      completeStructured: (async (req: Req) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return ok(req);
      }) as never,
    };
    await generateReports(llm, profile, ranked, { topN: 6 });
    expect(peak).toBe(3);
  });
});
