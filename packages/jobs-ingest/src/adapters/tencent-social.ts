import { Job } from "@talksume/core";
import {
  clean,
  type FetchContext,
  joinJd,
  normalizeCities,
  paginate,
  type SourceAdapter,
  wantType,
} from "../common.ts";

const BASE = "https://careers.tencent.com/tencentcareer/api/post";

export interface TencentSocialListItem {
  PostId: string;
  RecruitPostName: string;
  LocationName?: string | null;
  CategoryName?: string | null;
  BGName?: string | null;
  ProductName?: string | null;
  PostURL?: string | null;
}

export interface TencentSocialDetail extends TencentSocialListItem {
  Responsibility?: string | null;
  Requirement?: string | null;
}

export function normalizeTencentSocial(d: TencentSocialDetail, fetchedAt: Date): Job {
  return Job.parse({
    id: `tencent_social:${d.PostId}`,
    source: "tencent_social",
    sourceJobId: d.PostId,
    company: "腾讯",
    title: clean(d.RecruitPostName),
    cities: normalizeCities(d.LocationName),
    jobType: "experienced",
    jdText: joinJd([
      ["岗位职责", d.Responsibility],
      ["任职要求", d.Requirement],
    ]),
    url: (d.PostURL || `https://careers.tencent.com/jobdesc.html?postId=${d.PostId}`).replace(
      /^http:/,
      "https:",
    ),
    tags: [d.CategoryName, d.BGName, d.ProductName].filter((x): x is string => !!x),
    fetchedAt,
  });
}

export const tencentSocial: SourceAdapter = {
  name: "tencent_social",
  company: "腾讯",
  async *fetch(ctx: FetchContext) {
    if (!wantType(ctx, "experienced")) return;
    // attrId=1 为社招；countryId=1 限定中国大陆，校招与实习在 join.qq.com
    const list = paginate(ctx, "tencent_social 列表", async (n) => {
      const r = await ctx.http.json<{ Data: { Count: number; Posts: TencentSocialListItem[] } }>(
        `${BASE}/Query?pageIndex=${n}&pageSize=50&language=zh-cn&attrId=1&countryId=1`,
      );
      return { items: r.Data.Posts ?? [], hasMore: n * 50 < r.Data.Count };
    });
    for await (const it of list) {
      try {
        const r = await ctx.http.json<{ Data: TencentSocialDetail }>(
          `${BASE}/ByPostId?postId=${it.PostId}&language=zh-cn`,
        );
        yield normalizeTencentSocial(r.Data, ctx.now());
      } catch (e) {
        ctx.onError(`tencent_social 详情 ${it.PostId} 失败: ${(e as Error).message}`);
      }
    }
  },
};
