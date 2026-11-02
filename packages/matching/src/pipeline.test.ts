import { describe, expect, it } from "vitest";
import { CASES } from "../eval/dataset.ts";
import { evaluate } from "../eval/evaluate.ts";
import { cosine, createEmbedderFromEnv, OpenAiEmbedder } from "./embedder.ts";
import { makeJob, makeProfile } from "./fixtures.ts";
import {
  buildScoreContext,
  feedbackAdjustment,
  matchProfile,
  mergeWeights,
  SKILL_CURVE,
  scoreJob,
} from "./pipeline.ts";
import { DEFAULT_WEIGHTS, DIMENSIONS } from "./types.ts";

const backend = makeJob({
  title: "后台开发",
  jdText: "【任职要求】\n熟悉Java，了解MySQL、Redis\n计算机相关专业本科及以上",
});
const design = makeJob({ title: "视觉设计", jdText: "负责品牌视觉设计，熟悉Photoshop" });
const profile = makeProfile({
  skills: [
    { id: "1", name: "Java" },
    { id: "2", name: "MySQL" },
  ],
});

describe("matchProfile", () => {
  it("相关岗位排在前面，分数落在 0–100，每个维度都有证据", () => {
    const { matches } = matchProfile(profile, [design, backend]);
    expect(matches.map((m) => m.job.title)).toEqual(["后台开发", "视觉设计"]);
    const top = matches[0];
    expect(top?.score).toBeGreaterThan(60);
    for (const m of matches) {
      expect(m.score).toBeGreaterThanOrEqual(0);
      expect(m.score).toBeLessThanOrEqual(100);
      for (const k of DIMENSIONS) expect(m.dims[k].evidence.length).toBeGreaterThan(0);
    }
  });

  it("硬性过滤的剔除原因会被统计", () => {
    const out = matchProfile(profile, [backend, makeJob({ title: "后台开发", id: "bj", cities: ["北京"] })]);
    expect(out.matches).toHaveLength(1);
    expect(out.excluded.city).toBe(1);
  });

  it("不适用的维度权重归零，其余按比例放大", () => {
    const sparse = makeProfile({ intention: { roles: [], cities: [] }, education: [], projects: [] });
    const m = scoreJob(sparse, backend, buildScoreContext([backend]));
    expect(m.weights.role).toBe(0);
    expect(m.weights.city).toBe(0);
    expect(DIMENSIONS.reduce((s, k) => s + m.weights[k], 0)).toBeCloseTo(1, 5);
  });

  it("权重可配置，只认已知维度和非负数", () => {
    expect(mergeWeights({ skills: 0.5 })).toEqual({ ...DEFAULT_WEIGHTS, skills: 0.5 });
    expect(mergeWeights({ skills: -1, city: Number.NaN })).toEqual(DEFAULT_WEIGHTS);
    const ctx = buildScoreContext([backend]);
    const onlySkills = { skills: 1, role: 0, experience: 0, major: 0, city: 0 };
    const m = scoreJob(profile, backend, ctx, { weights: onlySkills });
    expect(m.score).toBeCloseTo(m.dims.skills.score ** SKILL_CURVE * 100, 0);
  });

  it("候选超过召回上限时只给最相关的打分", () => {
    const filler = Array.from({ length: 6 }, (_, i) =>
      makeJob({ title: `市场营销${i}`, id: `m${i}`, jdText: `负责市场推广活动${i}` }),
    );
    const out = matchProfile(profile, [...filler, backend], { recallLimit: 2 });
    expect(out.recalled).toBe(2);
    expect(out.matches.map((m) => m.job.id)).toContain(backend.id);
  });

  it("向量相似度参与召回排序", () => {
    const a = makeJob({ title: "市场A", id: "a", jdText: "推广" });
    const b = makeJob({ title: "市场B", id: "b", jdText: "推广" });
    const c = makeJob({ title: "市场C", id: "c", jdText: "推广" });
    const out = matchProfile(profile, [a, b, c], {
      recallLimit: 1,
      vectorScores: new Map([
        ["a", 0.2],
        ["c", 0.9],
      ]),
    });
    expect(out.matches[0]?.job.id).toBe("c");
  });

  it("没有向量的岗位按已知最低相似度参与，不会被压到最后", () => {
    const relevant = makeJob({
      id: "r",
      title: "后端开发工程师",
      jdText: "Java Spring MySQL Redis 后端开发",
    });
    const others = ["x", "y"].map((id) => makeJob({ id, title: "市场专员", jdText: "推广" }));
    const out = matchProfile(profile, [relevant, ...others], {
      recallLimit: 1,
      vectorScores: new Map([
        ["x", 0.5],
        ["y", 0.5],
      ]),
    });
    expect(out.matches[0]?.job.id).toBe("r");
  });
});

describe("反馈降权", () => {
  const disliked = { jobId: "x", company: "测试公司", title: "后端开发实习生", signal: "dislike" as const };

  it("同公司同岗位类别降权，不同公司或类别不受影响", () => {
    expect(
      feedbackAdjustment({ id: "y", company: "测试公司", title: "后台开发" }, [disliked]).multiplier,
    ).toBe(0.7);
    expect(feedbackAdjustment({ id: "y", company: "别家", title: "后台开发" }, [disliked]).multiplier).toBe(
      1,
    );
    expect(
      feedbackAdjustment({ id: "y", company: "测试公司", title: "视觉设计" }, [disliked]).multiplier,
    ).toBe(1);
  });

  it("本岗位被否定降得最狠，无关比不感兴趣更重，感兴趣小幅加权", () => {
    expect(
      feedbackAdjustment({ id: "x", company: "测试公司", title: "后端开发实习生" }, [disliked]).multiplier,
    ).toBe(0.3);
    const irrelevant = { ...disliked, signal: "irrelevant" as const };
    expect(
      feedbackAdjustment({ id: "y", company: "测试公司", title: "后台开发" }, [irrelevant]).multiplier,
    ).toBe(0.6);
    const liked = { ...disliked, signal: "like" as const };
    expect(
      feedbackAdjustment({ id: "y", company: "测试公司", title: "后台开发" }, [liked]).multiplier,
    ).toBeGreaterThan(1);
  });

  it("降权后的分数更低并带解释", () => {
    const ctx = buildScoreContext([backend]);
    const plain = scoreJob(profile, backend, ctx);
    const adj = scoreJob(profile, backend, ctx, { feedback: [disliked] });
    expect(adj.score).toBeLessThan(plain.score);
    expect(adj.feedbackEvidence[0]).toContain("降权");
  });
});

describe("Embedder", () => {
  it("OpenAI 兼容客户端按 index 还原顺序并校验维度", async () => {
    const vec = (n: number) => Array.from({ length: 4 }, () => n);
    let seen: { url: string; body: { model: string; input: string[] } } | undefined;
    const fakeFetch = (async (url: string, init: { body: string }) => {
      seen = { url, body: JSON.parse(init.body) };
      return Response.json({
        data: [
          { index: 1, embedding: vec(2) },
          { index: 0, embedding: vec(1) },
        ],
      });
    }) as unknown as typeof fetch;
    const embedder = new OpenAiEmbedder({
      baseUrl: "http://x/v1/",
      model: "bge-m3",
      dimensions: 4,
      fetch: fakeFetch,
    });
    expect(await embedder.embed(["a", "b"])).toEqual([vec(1), vec(2)]);
    expect(seen?.url).toBe("http://x/v1/embeddings");
    expect(seen?.body).toEqual({ model: "bge-m3", input: ["a", "b"] });

    const wrongDims = new OpenAiEmbedder({
      baseUrl: "http://x",
      model: "m",
      dimensions: 8,
      fetch: fakeFetch,
    });
    await expect(wrongDims.embed(["a", "b"])).rejects.toThrow("维度");

    const mrl = new OpenAiEmbedder({ baseUrl: "http://x", model: "m", dimensions: 2, fetch: fakeFetch });
    const [first] = await mrl.embed(["a", "b"]);
    expect(first).toHaveLength(2);
    for (const x of first ?? []) expect(x).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("没配置环境变量时不启用", () => {
    expect(createEmbedderFromEnv({})).toBeUndefined();
    expect(createEmbedderFromEnv({ EMBEDDING_BASE_URL: "http://x" })).toBeUndefined();
    expect(createEmbedderFromEnv({ EMBEDDING_BASE_URL: "http://x", EMBEDDING_MODEL: "m" })).toBeDefined();
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
});

describe("离线评测回归", () => {
  it("标注集上规则排序保持在基线之上", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(3);
    const report = evaluate();
    expect(report.rules.p5).toBeGreaterThanOrEqual(0.8);
    expect(report.rules.ndcg10).toBeGreaterThanOrEqual(0.85);
  });
});
