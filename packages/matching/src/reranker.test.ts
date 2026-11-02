import { afterEach, describe, expect, it, vi } from "vitest";
import { makeJob, makeProfile } from "./fixtures.ts";
import { buildScoreContext, scoreJob } from "./pipeline.ts";
import {
  applySemantic,
  blendSemantic,
  createRerankerFromEnv,
  DOC_MAX_CHARS,
  HttpReranker,
  QUERY_MAX_CHARS,
  type Reranker,
  rerankDocument,
  rerankQuery,
} from "./reranker.ts";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (body: { documents: string[] }, n: number) => Response) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(JSON.parse(String(init?.body)), calls.length);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const ok = (results: { index: number; relevance_score: number }[]) => Response.json({ results });
const byLength = (docs: string[]) =>
  ok(docs.map((d, index) => ({ index, relevance_score: d.length / 100 })).reverse());

describe("HttpReranker", () => {
  it("按约定发请求，乱序结果按 index 还原，超过批量上限时分批", async () => {
    const { fetch, calls } = fakeFetch((b) => byLength(b.documents));
    const r = new HttpReranker({ baseUrl: "http://x/v1/", model: "m", apiKey: "k", batchSize: 2, fetch });
    const scores = await r.rerank("q", ["a", "bb", "ccc"]);
    expect(scores).toEqual([0.01, 0.02, 0.03]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("http://x/v1/rerank");
    const headers = calls[0]?.init.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer k");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: "m",
      query: "q",
      documents: ["a", "bb"],
      top_n: 2,
    });
  });

  it("5xx 重试一次后成功；4xx 和结果缺条不重试", async () => {
    const flaky = fakeFetch((b, n) =>
      n === 1 ? new Response("busy", { status: 503 }) : byLength(b.documents),
    );
    const r = new HttpReranker({ baseUrl: "http://x", model: "m", retryDelayMs: 0, fetch: flaky.fetch });
    expect(await r.rerank("q", ["a"])).toEqual([0.01]);
    expect(flaky.calls).toHaveLength(2);

    const bad = fakeFetch(() => new Response("bad", { status: 400 }));
    const r2 = new HttpReranker({ baseUrl: "http://x", model: "m", retryDelayMs: 0, fetch: bad.fetch });
    await expect(r2.rerank("q", ["a"])).rejects.toThrow(/HTTP 400/);
    expect(bad.calls).toHaveLength(1);

    const short = fakeFetch(() => ok([{ index: 0, relevance_score: 0.5 }]));
    const r3 = new HttpReranker({ baseUrl: "http://x", model: "m", retryDelayMs: 0, fetch: short.fetch });
    await expect(r3.rerank("q", ["a", "b"])).rejects.toThrow(/不一致/);
    expect(short.calls).toHaveLength(1);
  });
});

describe("createRerankerFromEnv", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("没配地址或模型时禁用", () => {
    expect(createRerankerFromEnv({})).toBeUndefined();
    expect(createRerankerFromEnv({ RERANK_BASE_URL: "http://x" })).toBeUndefined();
    expect(createRerankerFromEnv({ RERANK_MODEL: "m" })).toBeUndefined();
  });

  it("没有 RERANK_API_KEY 时复用 EMBEDDING_API_KEY", async () => {
    const { fetch, calls } = fakeFetch((b) => byLength(b.documents));
    vi.stubGlobal("fetch", fetch);
    const env = { RERANK_BASE_URL: "http://x", RERANK_MODEL: "m", EMBEDDING_API_KEY: "emb" };
    await createRerankerFromEnv(env)?.rerank("q", ["a"]);
    await createRerankerFromEnv({ ...env, RERANK_API_KEY: "own" })?.rerank("q", ["a"]);
    const auth = calls.map((c) => (c.init.headers as Record<string, string>).authorization);
    expect(auth).toEqual(["Bearer emb", "Bearer own"]);
  });
});

describe("查询与文档文本", () => {
  it("画像拼成意向、技能、经历、项目，岗位取标题公司和 JD 开头，都不超过长度上限", () => {
    const profile = makeProfile({
      skills: Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, name: `技能${i}` })),
      experiences: [{ id: "x", kind: "internship", company: "某科技", title: "后端实习生" }],
      projects: [{ id: "p", name: "秒杀系统", techStack: ["Go", "Redis"] }],
    });
    const q = rerankQuery(profile);
    expect(q.startsWith("这个岗位适合以下求职者吗？求职意向：后端开发；技能：技能0、")).toBe(true);
    expect(q.length).toBeLessThanOrEqual(QUERY_MAX_CHARS);
    expect(rerankQuery(makeProfile({ skills: [], intention: { roles: [] }, education: [] }))).toBe("");

    const doc = rerankDocument(
      makeJob({ title: "后端开发", company: "某公司", jdText: "职责：\n\n写代码 ".repeat(200) }),
    );
    expect(doc.startsWith("后端开发｜某公司\n职责： 写代码 职责")).toBe(true);
    expect(doc.length).toBe(DOC_MAX_CHARS);

    const long = rerankDocument(
      makeJob({
        title: "后台开发",
        company: "某公司",
        jdText: `【岗位职责】${"维护服务".repeat(200)}【任职要求】熟悉 Go`,
      }),
    );
    expect(long).toContain("【任职要求】熟悉 Go");
    expect(long.length).toBeLessThanOrEqual(DOC_MAX_CHARS);
  });
});

const profile = makeProfile();
const jobs = ["后端开发工程师", "Java 后端开发", "Python 后端实习"].map((title) =>
  makeJob({ title, jdText: `${title}，熟悉 Python` }),
);
const ctx = buildScoreContext(jobs);
const scored = () =>
  jobs.map((j, i) => ({ ...scoreJob(profile, j, ctx), baseScore: 80 - i * 10, score: 80 - i * 10 }));

const stubReranker = (scores: number[] | Error, delayMs = 0): Reranker & { calls: string[][] } => {
  const calls: string[][] = [];
  return {
    calls,
    rerank: (_q, docs, signal) => {
      calls.push(docs);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => (scores instanceof Error ? reject(scores) : resolve(scores)), delayMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(signal.reason);
        });
      });
    },
  };
};

describe("语义分并入综合分", () => {
  it("按权重与规则分线性混合，保留反馈系数，并给出可解释的证据", () => {
    const [s] = scored();
    if (!s) throw new Error("no job");
    const adjusted = { ...s, baseScore: 60, score: 42, feedbackMultiplier: 0.7 };
    const out = blendSemantic(adjusted, 0.9, 0.25);
    expect(out.baseScore).toBe(67.5);
    expect(out.score).toBe(47.3);
    expect(out.semantic).toEqual({
      score: 0.9,
      weight: 0.25,
      evidence: [expect.stringContaining("高度相关")],
    });
    expect(blendSemantic(adjusted, 0.1, 0.25).semantic?.evidence[0]).toContain("关联不大");
  });

  it("只对前 K 个调用 rerank，混合后重新排序", async () => {
    const before = scored();
    const reranker = stubReranker([0, 1]);
    const res = await applySemantic(reranker, profile, before, { topK: 2, weight: 0.5 });
    expect(reranker.calls[0]).toHaveLength(2);
    expect(res.error).toBeUndefined();
    expect(res.reranked).toBe(2);
    expect(res.matches.map((m) => [m.job.title, m.score])).toEqual([
      ["Java 后端开发", 85],
      ["Python 后端实习", 60],
      ["后端开发工程师", 40],
    ]);
    expect(res.matches.find((m) => m.job.id === before[2]?.job.id)?.semantic).toBeUndefined();
  });

  it("rerank 出错或超时时原样返回规则结果并带上原因", async () => {
    const before = scored();
    const failed = await applySemantic(stubReranker(new Error("boom")), profile, before);
    expect(failed.matches).toBe(before);
    expect(String(failed.error)).toContain("boom");

    const slow = await applySemantic(stubReranker([1, 1, 1], 1000), profile, before, { timeoutMs: 20 });
    expect(slow.matches).toBe(before);
    expect((slow.error as Error).name).toBe("TimeoutError");
  });
});
