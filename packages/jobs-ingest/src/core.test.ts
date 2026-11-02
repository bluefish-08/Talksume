import type { Job } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { type FetchContext, normalizeCities, paginate, parseDegree, roundRobin } from "./common.ts";
import { createHttpClient, HttpError, RobotsBlockedError } from "./http.ts";
import { isAllowed, parseRobots } from "./robots.ts";
import { classifyRole } from "./role.ts";
import { selectSeed } from "./seed.ts";
import { computeStats } from "./stats.ts";

describe("normalizeCities", () => {
  it("统一成中文城市名并去重", () => {
    expect(normalizeCities("深圳总部 北京 上海 北京")).toEqual(["深圳", "北京", "上海"]);
    expect(normalizeCities(["北京市", "武汉市", "上海（临港）"])).toEqual(["北京", "武汉", "上海"]);
    expect(normalizeCities(["远程面试", "全国"])).toEqual([]);
    expect(normalizeCities(null)).toEqual([]);
  });
});

describe("parseDegree", () => {
  it("映射学历", () => {
    expect(parseDegree("本科")).toBe("bachelor");
    expect(parseDegree("硕士")).toBe("master");
    expect(parseDegree("不限")).toBe("any");
    expect(parseDegree("高中")).toBeUndefined();
  });
});

describe("roundRobin / paginate", () => {
  async function* gen(xs: number[]) {
    yield* xs;
  }
  const ctx = (errors: string[]): FetchContext => ({
    http: { json: async () => ({}) as never },
    limit: 1,
    now: () => new Date(),
    onError: (m) => errors.push(m),
  });

  it("轮流取并在耗尽后继续", async () => {
    const out: number[] = [];
    for await (const x of roundRobin([gen([1, 2, 3]), gen([10])])) out.push(x);
    expect(out).toEqual([1, 10, 2, 3]);
  });

  it("单页失败跳过，连续 3 页失败放弃", async () => {
    const errors: string[] = [];
    const seen: number[] = [];
    const out: number[] = [];
    for await (const x of paginate(ctx(errors), "t", async (n) => {
      seen.push(n);
      if (n === 2) throw new Error("x");
      return { items: [n], hasMore: n < 3 };
    }))
      out.push(x);
    expect(out).toEqual([1, 3]);
    expect(errors).toHaveLength(1);

    const errors2: string[] = [];
    for await (const _ of paginate(ctx(errors2), "t", async () => {
      throw new Error("down");
    })) {
    }
    expect(errors2).toHaveLength(3);
  });
});

describe("robots", () => {
  const ua = "TalksumeBot/0.1 (student competition)";
  it("按最长匹配判断，Allow 同长度优先", () => {
    const rules = parseRobots(
      "User-agent: *\nDisallow: /api/\nAllow: /api/public\nDisallow: /referral\n",
      ua,
    );
    expect(isAllowed(rules, "/api/private")).toBe(false);
    expect(isAllowed(rules, "/api/public/jobs")).toBe(true);
    expect(isAllowed(rules, "/referral")).toBe(false);
    expect(isAllowed(rules, "/campus")).toBe(true);
  });
  it("指定 UA 分组优先于 *", () => {
    const rules = parseRobots("User-agent: talksumebot\nDisallow: /\n\nUser-agent: *\nAllow: /\n", ua);
    expect(isAllowed(rules, "/x")).toBe(false);
  });
  it("空 Disallow 表示全部允许", () => {
    expect(isAllowed(parseRobots("User-agent: *\nDisallow:\n", ua), "/x")).toBe(true);
  });
});

describe("http client", () => {
  function setup(responder: (url: string, n: number) => Response | Promise<Response>) {
    let clock = 0;
    const sleeps: number[] = [];
    const log: { url: string; at: number }[] = [];
    const client = createHttpClient({
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      fetchImpl: (async (url: string) => {
        log.push({ url, at: clock });
        return responder(url, log.length);
      }) as typeof fetch,
      backoffMs: 10,
    });
    return { client, sleeps, log };
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const noRobots = () => new Response("not found", { status: 404 });

  it("同一域名请求间隔不低于 1 秒", async () => {
    const { client, log } = setup((url) => (url.endsWith("robots.txt") ? noRobots() : json({ ok: 1 })));
    await client.json("https://a.example/x");
    await client.json("https://a.example/y");
    await client.json("https://b.example/z");
    const a = log.filter((l) => l.url.startsWith("https://a.example"));
    for (let i = 1; i < a.length; i++)
      expect((a[i]?.at ?? 0) - (a[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(1000);
  });

  it("5xx 与网络错误重试后成功", async () => {
    let calls = 0;
    const { client } = setup((url) => {
      if (url.endsWith("robots.txt")) return noRobots();
      calls++;
      if (calls === 1) return json({}, 503);
      if (calls === 2) throw new Error("ECONNRESET");
      return json({ ok: true });
    });
    expect(await client.json("https://a.example/x")).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("4xx 不重试，重试耗尽后抛出", async () => {
    let calls = 0;
    const { client } = setup((url) => {
      if (url.endsWith("robots.txt")) return noRobots();
      calls++;
      return json({}, 403);
    });
    await expect(client.json("https://a.example/x")).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(1);

    let calls2 = 0;
    const s2 = setup((url) => {
      if (url.endsWith("robots.txt")) return noRobots();
      calls2++;
      return json({}, 500);
    });
    await expect(s2.client.json("https://a.example/x")).rejects.toBeInstanceOf(HttpError);
    expect(calls2).toBe(4);
  });

  it("robots.txt 禁止的路径不请求", async () => {
    let hits = 0;
    const { client } = setup((url) => {
      if (url.endsWith("robots.txt"))
        return new Response("User-agent: *\nDisallow: /private\n", {
          headers: { "content-type": "text/plain" },
        });
      hits++;
      return json({});
    });
    await expect(client.json("https://a.example/private/list")).rejects.toBeInstanceOf(RobotsBlockedError);
    await client.json("https://a.example/open");
    expect(hits).toBe(1);
  });
});

function job(over: Partial<Job> & { id: string }): Job {
  return {
    source: "s",
    sourceJobId: over.id,
    company: "A",
    title: "后端开发工程师",
    cities: ["北京"],
    jobType: "campus",
    jdText: "x".repeat(100),
    tags: [],
    fetchedAt: new Date(),
    ...over,
  };
}

describe("classifyRole", () => {
  it("按标题分类", () => {
    expect(classifyRole({ title: "后端开发工程师" })).toBe("tech");
    expect(classifyRole({ title: "产品经理实习生" })).toBe("product");
    expect(classifyRole({ title: "游戏策划" })).toBe("product");
    expect(classifyRole({ title: "UI设计师" })).toBe("design");
    expect(classifyRole({ title: "场景模型师" })).toBe("design");
    expect(classifyRole({ title: "小蜜蜂运营实习生" })).toBe("ops");
    expect(classifyRole({ title: "法务" })).toBe("other");
  });
});

describe("selectSeed / computeStats", () => {
  const jobs: Job[] = [
    ...Array.from({ length: 10 }, (_, i) => job({ id: `a${i}`, company: "A", title: "后端开发工程师" })),
    ...Array.from({ length: 10 }, (_, i) =>
      job({ id: `b${i}`, company: "B", title: "产品经理", jobType: "internship" }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      job({ id: `c${i}`, company: "C", title: "UI设计师", jobType: "experienced" }),
    ),
    job({ id: "short", jdText: "短" }),
    job({ id: "nocity", cities: [] }),
  ];

  it("按配额选取、过滤残缺数据、互不重复", () => {
    const seed = selectSeed(jobs, { size: 12, quotas: { tech: 4, product: 4, design: 4, ops: 0, other: 0 } });
    expect(seed).toHaveLength(12);
    expect(new Set(seed.map((j) => j.id)).size).toBe(12);
    expect(seed.some((j) => j.id === "short" || j.id === "nocity")).toBe(false);
    expect(seed.filter((j) => classifyRole(j) === "design")).toHaveLength(4);
  });

  it("配额不足时由其余类别补齐", () => {
    const seed = selectSeed(jobs, {
      size: 25,
      quotas: { tech: 1, product: 1, design: 1, ops: 20, other: 20 },
    });
    expect(seed).toHaveLength(25);
  });

  it("统计完整率", () => {
    const s = computeStats(jobs);
    expect(s.total).toBe(32);
    expect(s.withCity).toBe(31);
    expect(s.withJd).toBe(31);
    expect(s.byType.internship).toBe(10);
  });
});
