import { describe, expect, it } from "vitest";
import type { FetchContext } from "../common.ts";
import { loadFixture } from "../fixtures/load.ts";
import type { HttpClient } from "../http.ts";
import { type MeituanJob, meituan, normalizeMeituan } from "./meituan.ts";
import { type MihoyoDetail, mihoyo, normalizeMihoyo } from "./mihoyo.ts";
import { type NeteasePosition, netease, normalizeNetease } from "./netease.ts";
import { normalizeTencentCampus, type TencentCampusDetail, tencentCampus } from "./tencent-campus.ts";
import { normalizeTencentSocial, type TencentSocialDetail, tencentSocial } from "./tencent-social.ts";

const at = new Date("2026-11-02T00:00:00Z");

function ctx(http: HttpClient, extra: Partial<FetchContext> = {}): FetchContext & { errors: string[] } {
  const errors: string[] = [];
  return { http, limit: 100, now: () => at, onError: (m) => errors.push(m), errors, ...extra };
}

async function collect<T>(g: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of g) out.push(x);
  return out;
}

describe("tencent_campus", () => {
  const fx = loadFixture<{
    items: { postId: string; projectId: number; projectName: string; positionTitle: string }[];
    details: TencentCampusDetail[];
  }>("tencent-campus");

  it("规范化校招与实习", () => {
    const [campus, intern] = fx.details.map((d) => normalizeTencentCampus(d, at));
    expect(campus?.jobType).toBe("campus");
    expect(intern?.jobType).toBe("internship");
    expect(campus?.id).toBe(`tencent_campus:${fx.details[0]?.postId}`);
    expect(campus?.company).toBe("腾讯");
    expect(campus?.cities.length).toBeGreaterThan(0);
    expect(campus?.cities.some((c) => c.includes("总部"))).toBe(false);
    expect(campus?.jdText).toContain("【岗位职责】");
    expect(campus?.jdText).toContain("【任职要求】");
    expect(campus?.fetchedAt).toEqual(at);
  });

  it("青云课题类实习的职责写在 topicDetail 里", () => {
    const base = fx.details[1] as TencentCampusDetail;
    const job = normalizeTencentCampus(
      { ...base, desc: "", request: "", topicDetail: "课题背景：强化学习", topicRequirement: "硕士以上" },
      at,
    );
    expect(job.jdText).toContain("【课题内容】\n课题背景：强化学习");
    expect(job.jdText).toContain("【课题要求】");
  });

  it("按类型轮流取详情，单条详情失败只跳过该条", async () => {
    const [a, b] = fx.items;
    const http = {
      async json<T>(url: string): Promise<T> {
        if (url.includes("searchPosition"))
          return { data: { positionList: [a, b, { ...b, postId: "bad" }], count: 3 } } as T;
        const id = new URL(url).searchParams.get("postId");
        if (id === "bad") throw new Error("boom");
        return { data: fx.details[id === a?.postId ? 0 : 1] } as T;
      },
    };
    const c = ctx(http);
    const jobs = await collect(tencentCampus.fetch(c));
    expect(jobs.map((j) => j.jobType).sort()).toEqual(["campus", "internship"]);
    expect(c.errors).toHaveLength(1);
    expect(c.errors[0]).toContain("bad");
  });

  it("已下架返回空详情时跳过，详情缺 postId 时用列表的", async () => {
    const [a, b] = fx.items;
    const http = {
      async json<T>(url: string): Promise<T> {
        if (url.includes("searchPosition")) return { data: { positionList: [a, b], count: 2 } } as T;
        if (url.includes(`postId=${a?.postId}`)) return { data: null, message: "岗位已下架" } as T;
        return { data: { ...fx.details[1], postId: null } } as T;
      },
    };
    const c = ctx(http);
    const jobs = await collect(tencentCampus.fetch(c));
    expect(jobs.map((j) => j.sourceJobId)).toEqual([b?.postId]);
    expect(c.errors[0]).toContain("岗位已下架");
  });

  it("续抓时已抓过的岗位不再请求详情", async () => {
    const [a, b] = fx.items;
    const urls: string[] = [];
    const http = {
      async json<T>(url: string): Promise<T> {
        urls.push(url);
        if (url.includes("searchPosition")) return { data: { positionList: [a, b], count: 2 } } as T;
        return { data: fx.details[1] } as T;
      },
    };
    const c = { ...ctx(http), skip: (id: string) => id === `tencent_campus:${a?.postId}` };
    const jobs = await collect(tencentCampus.fetch(c));
    expect(jobs).toHaveLength(1);
    expect(urls.some((u) => u.includes(`postId=${a?.postId}`))).toBe(false);
  });

  it("types 过滤在取详情前生效", async () => {
    const urls: string[] = [];
    const [a, b] = fx.items;
    const http = {
      async json<T>(url: string): Promise<T> {
        urls.push(url);
        if (url.includes("searchPosition")) return { data: { positionList: [a, b], count: 2 } } as T;
        return { data: fx.details[1] } as T;
      },
    };
    const jobs = await collect(tencentCampus.fetch(ctx(http, { types: ["internship"] })));
    expect(jobs).toHaveLength(1);
    expect(urls.filter((u) => u.includes("getJobDetails"))).toHaveLength(1);
  });
});

describe("tencent_social", () => {
  const fx = loadFixture<{ items: unknown[]; details: TencentSocialDetail[] }>("tencent-social");

  it("规范化社招职位", () => {
    const job = normalizeTencentSocial(fx.details[0] as TencentSocialDetail, at);
    expect(job.source).toBe("tencent_social");
    expect(job.jobType).toBe("experienced");
    expect(job.cities).toHaveLength(1);
    expect(job.url).toMatch(/^https:\/\/careers\.tencent\.com\/jobdesc\.html\?postId=/);
    expect(job.jdText).toContain("【任职要求】");
    expect(job.tags.length).toBeGreaterThan(0);
  });

  it("types 不含 experienced 时不发请求", async () => {
    const http: HttpClient = {
      async json() {
        throw new Error("不应请求");
      },
    };
    expect(await collect(tencentSocial.fetch(ctx(http, { types: ["campus"] })))).toEqual([]);
  });
});

describe("netease", () => {
  const fx = loadFixture<{ items: NeteasePosition[] }>("netease");

  it("workType 映射为招聘类型，城市去掉'市'后缀", () => {
    const jobs = fx.items.map((p) => normalizeNetease(p, at));
    expect(jobs.map((j) => j?.jobType)).toEqual(["internship", "internship", "experienced", "experienced"]);
    expect(jobs[0]?.cities).toEqual(["北京"]);
    expect(jobs[0]?.degree).toBeDefined();
    expect(jobs[0]?.id).toBe(`netease:${fx.items[0]?.id}`);
  });

  it("派遣岗位（workType=2）不采集", () => {
    expect(normalizeNetease({ ...(fx.items[0] as NeteasePosition), workType: "2" }, at)).toBeUndefined();
  });

  it("两类轮流返回", async () => {
    const http = {
      async json<T>(_url: string, req?: { json?: unknown }): Promise<T> {
        const wt = ((req?.json ?? {}) as { workType?: string }).workType;
        return { data: { pages: 1, list: fx.items.filter((p) => p.workType === wt) } } as T;
      },
    };
    const jobs = await collect(netease.fetch(ctx(http)));
    expect(jobs.map((j) => j.jobType)).toEqual(["internship", "experienced", "internship", "experienced"]);
  });
});

describe("meituan", () => {
  const fx = loadFixture<{ items: MeituanJob[] }>("meituan");

  it("jobType 1/2/3 映射为校招/实习/社招", () => {
    const jobs = fx.items.map((p) => normalizeMeituan(p, at));
    expect(jobs.map((j) => j?.jobType)).toEqual(["campus", "internship", "experienced"]);
    for (const j of jobs) {
      expect(j?.jdText).toContain("【岗位职责】");
      expect(j?.cities.every((c) => !c.endsWith("市"))).toBe(true);
      expect(j?.url).toContain("jobUnionId=");
    }
  });

  it("未知 jobType 返回 undefined", () => {
    expect(normalizeMeituan({ ...(fx.items[0] as MeituanJob), jobType: "9" }, at)).toBeUndefined();
  });

  it("分页直到 totalPage", async () => {
    const calls: number[] = [];
    const http = {
      async json<T>(_url: string, req?: { json?: unknown }): Promise<T> {
        const body = req?.json as { page: { pageNo: number }; jobType: { code: string }[] };
        calls.push(body.page.pageNo);
        const base = fx.items[0] as MeituanJob;
        return {
          data: {
            list: [
              {
                ...base,
                jobUnionId: `${body.jobType[0]?.code}-${body.page.pageNo}`,
                jobType: body.jobType[0]?.code,
              },
            ],
            page: { totalPage: 2 },
          },
        } as T;
      },
    };
    const jobs = await collect(meituan.fetch(ctx(http)));
    expect(jobs).toHaveLength(6);
    expect(Math.max(...calls)).toBe(2);
  });
});

describe("mihoyo", () => {
  const fx = loadFixture<{ items: unknown[]; details: MihoyoDetail[] }>("mihoyo");

  it("规范化校招与实习", () => {
    const [full, intern] = fx.details.map((d) => normalizeMihoyo(d, at));
    expect(full?.jobType).toBe("campus");
    expect(intern?.jobType).toBe("internship");
    expect(full?.cities).toEqual(["上海"]);
    expect(full?.company).toBe("米哈游");
    expect(full?.jdText).toContain("【任职要求】");
    expect(intern?.jdText).toContain("【实习要求】");
  });

  it("详情失败不中断整批", async () => {
    const http = {
      async json<T>(url: string, req?: { json?: { id?: string } }): Promise<T> {
        if (url.endsWith("/job/list")) return { data: { list: fx.items, total: 2 } } as T;
        if (req?.json?.id === (fx.items[0] as { id: string }).id) throw new Error("boom");
        return { data: fx.details[1] } as T;
      },
    };
    const c = ctx(http);
    const jobs = await collect(mihoyo.fetch(c));
    expect(jobs).toHaveLength(1);
    expect(c.errors).toHaveLength(1);
  });
});
