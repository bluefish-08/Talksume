import { createDb, type DbHandle, migrate, schema } from "@talksume/db";
import { count, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Embedder } from "./embedder.ts";
import { makeProfile } from "./fixtures.ts";
import { embedPendingJobs, vectorScores } from "./recall-db.ts";
import type { StructuredLlm } from "./rerank.ts";
import type { Reranker } from "./reranker.ts";
import { seedJobs, seedJobsIfEmpty } from "./seed.ts";
import { createMatchingService, MatchingError, REPORT_STALE_MS, reportStatusOf } from "./service.ts";
import { tokenize } from "./text.ts";

let handle: DbHandle;

beforeAll(async () => {
  handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
});
afterAll(() => handle.close());

async function newUser(profile?: ReturnType<typeof makeProfile>): Promise<string> {
  const email = `${crypto.randomUUID()}@t.local`;
  const [u] = await handle.db.insert(schema.users).values({ email }).returning();
  if (!u) throw new Error("user");
  if (profile) await handle.db.insert(schema.profiles).values({ userId: u.id, data: profile });
  return u.id;
}

const backendProfile = () =>
  makeProfile({
    skills: ["Java", "Golang", "MySQL", "Redis", "Linux"].map((name, i) => ({ id: `s${i}`, name })),
    projects: [{ id: "p", name: "秒杀系统", role: "后端开发", techStack: ["Spring Boot", "Redis", "Kafka"] }],
    intention: { roles: ["后端开发工程师"], cities: ["上海", "北京"] },
  });

describe("种子岗位", () => {
  it("空表时灌入 200 条，重复执行幂等", async () => {
    expect(await seedJobsIfEmpty(handle.db)).toBe(200);
    expect(await seedJobsIfEmpty(handle.db)).toBe(0);
    await seedJobs(handle.db);
    const [row] = await handle.db.select({ n: count() }).from(schema.jobs);
    expect(row?.n).toBe(200);
  });
});

describe("刷新与推荐列表", () => {
  const service = () => createMatchingService(handle.db, { llm: null });

  it("没有画像时给出明确错误", async () => {
    const userId = await newUser();
    await expect(service().refresh(userId)).rejects.toMatchObject({ code: "profile_not_found", status: 409 });
    await expect(service().refresh(userId)).rejects.toBeInstanceOf(MatchingError);
  });

  it("刷新后按分数降序返回，带维度证据和岗位摘要", async () => {
    const userId = await newUser(backendProfile());
    const res = await service().refresh(userId);
    expect(res.rerank).toBe("skipped");
    expect(res.count).toBeGreaterThan(10);

    const { items, total } = await service().listMatches(userId, 10);
    expect(total).toBe(res.count);
    expect(items).toHaveLength(10);
    const scores = items.map((i) => i.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const top = items[0];
    expect(top?.job.title).toBeTruthy();
    expect(top?.dims.skills?.evidence?.length).toBeGreaterThan(0);
    expect(top?.feedback).toBeNull();
    expect(items.slice(0, 5).some((i) => /后台|后端|服务端/.test(i.job.title))).toBe(true);
    for (const i of items) expect(i.job.cities.some((c) => ["上海", "北京"].includes(c))).toBe(true);
  });

  it("再次刷新会替换旧结果而不是累加", async () => {
    const userId = await newUser(backendProfile());
    const first = await service().refresh(userId);
    const second = await service().refresh(userId);
    expect(second.count).toBe(first.count);
    const [row] = await handle.db
      .select({ n: count() })
      .from(schema.matchResults)
      .where(eq(schema.matchResults.userId, userId));
    expect(row?.n).toBe(first.count);
  });

  it("没有符合条件的岗位时给出放宽建议", async () => {
    const userId = await newUser(makeProfile({ intention: { roles: ["后端"], cities: ["火星"] } }));
    const res = await service().refresh(userId);
    expect(res.count).toBe(0);
    expect(res.hint).toContain("城市");
  });
});

describe("反馈影响推荐", () => {
  it("不感兴趣会降低该岗位和同公司同类岗位的分数，并写入解释", async () => {
    const service = createMatchingService(handle.db, { llm: null });
    const userId = await newUser(backendProfile());
    await service.refresh(userId);
    const before = (await service.listMatches(userId, 100)).items;
    const target = before.find((i) => /后台|后端/.test(i.job.title));
    if (!target) throw new Error("no backend job");
    const sibling = before.find(
      (i) =>
        i.jobId !== target.jobId && i.job.company === target.job.company && /后台|后端/.test(i.job.title),
    );

    const saved = await service.recordFeedback(userId, target.jobId, "dislike", "不想去这家");
    expect(saved.signal).toBe("dislike");
    await service.refresh(userId);
    const after = (await service.listMatches(userId, 100)).items;
    const now = after.find((i) => i.jobId === target.jobId);
    expect(now?.score).toBeLessThan(target.score * 0.5);
    expect(now?.dims.feedback?.evidence?.[0]).toContain("降权");
    expect(now?.feedback).toBe("dislike");
    if (sibling) {
      const sib = after.find((i) => i.jobId === sibling.jobId);
      expect(sib?.score).toBeLessThan(sibling.score);
    }
  });

  it("岗位不存在返回 404 错误", async () => {
    const service = createMatchingService(handle.db, { llm: null });
    const userId = await newUser();
    await expect(service.recordFeedback(userId, "nope", "like")).rejects.toMatchObject({ status: 404 });
  });
});

describe("LLM 匹配报告", () => {
  type Req = Parameters<StructuredLlm["completeStructured"]>[0];
  const okValue = (req: Req) =>
    req.validate({ summary: "整体匹配", strengths: ["技能对口"], gaps: ["缺少实习"] });
  const rerank = { retryDelayMs: 0, attemptTimeoutMs: 100 };

  it("只给前 N 个岗位生成报告，单个失败标记为可重试且不影响其余", async () => {
    let calls = 0;
    const llm: StructuredLlm = {
      completeStructured: async <T>(req: Req) => {
        if (++calls === 2) throw new Error("boom");
        return { value: okValue(req) as T, text: "", model: "fake" };
      },
    };
    const service = createMatchingService(handle.db, {
      llm,
      rerankTopN: 4,
      rerank: { ...rerank, attempts: 1 },
      onError: () => {},
    });
    const userId = await newUser(backendProfile());
    const res = await service.refresh(userId);
    expect(res.rerank).toBe("pending");
    await res.done;
    const items = (await service.listMatches(userId, 20)).items;
    const top = items.slice(0, 4);
    expect(top.filter((i) => i.reportStatus === "ready")).toHaveLength(3);
    expect(top.filter((i) => i.reportStatus === "failed")).toHaveLength(1);
    expect(top.find((i) => i.reportStatus === "ready")?.report.strengths).toEqual(["技能对口"]);
    expect(items.slice(4).every((i) => i.reportStatus === "none")).toBe(true);
    expect(items.every((i) => !("status" in i.report))).toBe(true);
  });

  it("报告随完成逐个写入，最慢的一个不会拖住其余；生成中状态为 pending", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const llm: StructuredLlm = {
      completeStructured: async <T>(req: Req) => {
        if (++calls === 1) await gate;
        return { value: okValue(req) as T, text: "", model: "fake" };
      },
    };
    const service = createMatchingService(handle.db, { llm, rerankTopN: 3, rerank: { concurrency: 3 } });
    const userId = await newUser(backendProfile());
    const res = await service.refresh(userId);
    await vi.waitFor(async () => {
      const top = (await service.listMatches(userId, 3)).items.map((i) => i.reportStatus);
      expect(top.filter((x) => x === "ready")).toHaveLength(2);
      expect(top.filter((x) => x === "pending")).toHaveLength(1);
    });
    release?.();
    await res.done;
    const after = (await service.listMatches(userId, 3)).items;
    expect(after.every((i) => i.reportStatus === "ready")).toBe(true);
  });

  it("模型卡住时单次超时放弃并重发，重发成功则报告可用", async () => {
    let calls = 0;
    const llm: StructuredLlm = {
      completeStructured: async <T>(req: Req) => {
        if (++calls === 1) {
          await new Promise<void>((_, reject) =>
            req.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
          );
        }
        return { value: okValue(req) as T, text: "", model: "fake" };
      },
    };
    const service = createMatchingService(handle.db, {
      llm,
      rerankTopN: 1,
      rerank: { ...rerank, attemptTimeoutMs: 30 },
    });
    const userId = await newUser(backendProfile());
    await (await service.refresh(userId)).done;
    expect(calls).toBe(2);
    expect((await service.listMatches(userId, 1)).items[0]?.reportStatus).toBe("ready");
  });

  it("失败的报告可以单独重试；已有报告或生成中不重复调用模型", async () => {
    let healthy = false;
    let calls = 0;
    const llm: StructuredLlm = {
      completeStructured: async <T>(req: Req) => {
        calls++;
        if (!healthy) throw new Error("down");
        await new Promise((r) => setTimeout(r, 30));
        return { value: okValue(req) as T, text: "", model: "fake" };
      },
    };
    const service = createMatchingService(handle.db, {
      llm,
      rerankTopN: 2,
      rerank: { ...rerank, attempts: 1 },
      onError: () => {},
    });
    const userId = await newUser(backendProfile());
    await (await service.refresh(userId)).done;
    const [first] = (await service.listMatches(userId, 2)).items;
    expect(first?.reportStatus).toBe("failed");

    healthy = true;
    const retry = await service.retryReport(userId, first?.jobId ?? "");
    expect(retry.reportStatus).toBe("pending");
    expect((await service.listMatches(userId, 1)).items[0]?.reportStatus).toBe("pending");
    await retry.done;
    expect((await service.listMatches(userId, 1)).items[0]?.reportStatus).toBe("ready");

    const before = calls;
    expect((await service.retryReport(userId, first?.jobId ?? "")).reportStatus).toBe("ready");
    expect(calls).toBe(before);
    await expect(service.retryReport(userId, "nope")).rejects.toMatchObject({ status: 404 });
  });

  it("长期卡在 pending 的报告按失败处理，前端不会一直转圈", () => {
    const old = new Date(Date.now() - REPORT_STALE_MS - 1000).toISOString();
    expect(reportStatusOf({ status: "pending", startedAt: old })).toBe("failed");
    expect(reportStatusOf({ status: "pending", startedAt: new Date().toISOString() })).toBe("pending");
    expect(reportStatusOf({ status: "pending" })).toBe("failed");
    expect(reportStatusOf({})).toBe("none");
    expect(reportStatusOf({ status: "failed" })).toBe("failed");
    expect(reportStatusOf({ summary: "x", status: "pending" })).toBe("ready");
  });

  it("LLM 全部失败时规则结果照常返回", async () => {
    const llm: StructuredLlm = {
      completeStructured: async () => {
        throw new Error("down");
      },
    };
    const service = createMatchingService(handle.db, { llm, onError: () => {}, rerank });
    const userId = await newUser(backendProfile());
    const res = await service.refresh(userId);
    await res.done;
    expect(res.count).toBeGreaterThan(0);
    const [top] = (await service.listMatches(userId, 5)).items;
    expect(top?.report).toEqual({});
    expect(top?.reportStatus).toBe("failed");
  });
});

describe("导入 JD（无 LLM）", () => {
  const jd = `岗位名称：后端开发实习生
公司：某某科技
工作地点：上海
【任职要求】
1. 本科及以上学历，计算机相关专业；
2. 熟悉Java、MySQL、Redis；
3. 每周出勤4天以上，实习期3个月以上。`;

  it("用规则抽取标题、公司、城市，并按用户画像打分；相同文本幂等", async () => {
    const service = createMatchingService(handle.db, { llm: null });
    const userId = await newUser(backendProfile());
    const res = await service.importJob(userId, { text: jd, url: "https://example.com/jd/1" });
    expect(res.job).toMatchObject({
      source: "user_import",
      title: "后端开发实习生",
      company: "某某科技",
      cities: ["上海"],
      jobType: "internship",
      url: "https://example.com/jd/1",
    });
    expect(res.match?.score).toBeGreaterThan(50);
    expect(res.match?.dims.skills?.evidence?.join("")).toContain("Java");

    const again = await service.importJob(userId, { text: jd });
    expect(again.job.id).toBe(res.job.id);
    const [n] = await handle.db
      .select({ n: count() })
      .from(schema.jobs)
      .where(eq(schema.jobs.source, "user_import"));
    expect(n?.n).toBe(1);
  });

  it("导入的岗位只对导入者可见", async () => {
    const service = createMatchingService(handle.db, { llm: null });
    const owner = await newUser(backendProfile());
    const other = await newUser(backendProfile());
    const { job } = await service.importJob(owner, { text: `${jd}\n（仅 owner 可见）` });
    expect(await service.getJob(owner, job.id)).toBeDefined();
    expect(await service.getJob(other, job.id)).toBeUndefined();
    const search = { q: "仅 owner 可见", page: 1, pageSize: 10 };
    expect((await service.searchJobs(owner, search)).total).toBe(1);
    expect((await service.searchJobs(other, search)).total).toBe(0);
    await service.refresh(other);
    expect((await service.listMatches(other, 200)).items.some((i) => i.jobId === job.id)).toBe(false);
  });

  it("没有画像时只返回岗位；LLM 抽取结果优先，失败则退回规则", async () => {
    const userId = await newUser();
    const llm: StructuredLlm = {
      completeStructured: async <T>(req: Parameters<StructuredLlm["completeStructured"]>[0]) => ({
        value: req.validate({
          company: "LLM公司",
          title: "LLM岗位",
          cities: ["杭州市"],
          jobType: "campus",
        }) as T,
        text: "",
        model: "fake",
      }),
    };
    const withLlm = await createMatchingService(handle.db, { llm }).importJob(userId, {
      text: `${jd}\n（llm）`,
    });
    expect(withLlm.match).toBeNull();
    expect(withLlm.job).toMatchObject({
      company: "LLM公司",
      title: "LLM岗位",
      cities: ["杭州"],
      jobType: "campus",
    });

    const broken: StructuredLlm = {
      completeStructured: async () => {
        throw new Error("down");
      },
    };
    const fallback = await createMatchingService(handle.db, { llm: broken, onError: () => {} }).importJob(
      userId,
      {
        text: `${jd}\n（broken）`,
      },
    );
    expect(fallback.job.title).toBe("后端开发实习生");
  });
});

describe("岗位搜索", () => {
  const service = () => createMatchingService(handle.db, { llm: null });

  it("按关键词、城市、类型、公司过滤并分页", async () => {
    const userId = await newUser();
    const all = await service().searchJobs(userId, { page: 1, pageSize: 5 });
    expect(all.total).toBe(200);
    expect(all.items).toHaveLength(5);
    const page2 = await service().searchJobs(userId, { page: 2, pageSize: 5 });
    expect(page2.items[0]?.id).not.toBe(all.items[0]?.id);

    const q = await service().searchJobs(userId, { q: "后台开发", page: 1, pageSize: 50 });
    expect(q.total).toBeGreaterThan(0);
    expect(q.items[0]?.title).toContain("后台开发");

    const filtered = await service().searchJobs(userId, {
      city: "杭州",
      jobType: "internship",
      company: "网易",
      page: 1,
      pageSize: 50,
    });
    expect(filtered.total).toBeGreaterThan(0);
    for (const j of filtered.items) {
      expect(j.cities).toContain("杭州");
      expect(j.jobType).toBe("internship");
      expect(j.company).toBe("网易");
    }
  });

  it("关键词里的通配符按字面处理", async () => {
    const userId = await newUser();
    expect((await service().searchJobs(userId, { q: "%", page: 1, pageSize: 5 })).total).toBe(0);
  });
});

describe("向量召回（可选）", () => {
  const dims = 1024;
  const fake: Embedder = {
    dimensions: dims,
    embed: async (texts) =>
      texts.map((t) => {
        const v = new Array<number>(dims).fill(0);
        for (const token of tokenize(t)) {
          let h = 0;
          for (const ch of token) h = (h * 31 + ch.charCodeAt(0)) % dims;
          v[h] = (v[h] ?? 0) + 1;
        }
        return v;
      }),
  };

  it("补全岗位向量后，相似度召回与刷新都能工作", async () => {
    const done = await embedPendingJobs(handle.db, fake, 64);
    expect(done).toBeGreaterThanOrEqual(200);
    const [row] = await handle.db
      .select({ n: count() })
      .from(schema.jobs)
      .where(isNotNull(schema.jobs.embedding));
    expect(row?.n).toBe(done);
    expect(await embedPendingJobs(handle.db, fake)).toBe(0);

    const userId = await newUser(backendProfile());
    const scores = await vectorScores(handle.db, userId, fake, backendProfile(), 50);
    expect(scores.size).toBe(50);

    const service = createMatchingService(handle.db, { llm: null, embedder: fake, recallLimit: 30 });
    const res = await service.refresh(userId);
    expect(res.count).toBeGreaterThan(0);
    expect(res.count).toBeLessThanOrEqual(30);
  });

  it("嵌入服务出错时退回关键词召回", async () => {
    const broken: Embedder = {
      dimensions: dims,
      embed: async () => {
        throw new Error("down");
      },
    };
    const service = createMatchingService(handle.db, { llm: null, embedder: broken, onError: () => {} });
    const res = await service.refresh(await newUser(backendProfile()));
    expect(res.count).toBeGreaterThan(0);
  });
});

describe("语义重排（可选）", () => {
  const reranker = (impl: Reranker["rerank"]): Reranker => ({ rerank: vi.fn(impl) });

  it("成功时前 K 个带语义维度，排序与分数一致，并记录耗时", async () => {
    const userId = await newUser(backendProfile());
    const info = vi.fn();
    const r = reranker(async (_q, docs) =>
      docs.map((d) => (/后台|后端|服务端/.test(d.split("\n")[0] ?? "") ? 1 : 0)),
    );
    const service = createMatchingService(handle.db, {
      llm: null,
      reranker: r,
      semantic: { topK: 5 },
      onInfo: info,
    });
    await service.refresh(userId);
    expect((r.rerank as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toHaveLength(5);
    const { items } = await service.listMatches(userId, 100);
    expect(items.filter((i) => i.dims.semantic)).toHaveLength(5);
    expect(items[0]?.dims.semantic?.evidence?.[0]).toContain("语义模型");
    expect(info).toHaveBeenCalledWith(
      "语义重排完成",
      expect.objectContaining({ purpose: "refresh", reranked: 5 }),
    );
  });

  it("rerank 失败时推荐照常返回规则结果，并记录原因", async () => {
    const userId = await newUser(backendProfile());
    const onError = vi.fn();
    const plain = await createMatchingService(handle.db, { llm: null }).refresh(userId);
    const r = reranker(async () => {
      throw new Error("rerank down");
    });
    const res = await createMatchingService(handle.db, { llm: null, reranker: r, onError }).refresh(userId);
    expect(res.count).toBe(plain.count);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("退回规则排序"), expect.any(Error));
    const { items } = await createMatchingService(handle.db, { llm: null }).listMatches(userId, 100);
    expect(items.some((i) => i.dims.semantic)).toBe(false);
  });
});
