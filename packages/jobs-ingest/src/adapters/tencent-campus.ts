import { Job } from "@talksume/core";
import {
  clean,
  type FetchContext,
  joinJd,
  normalizeCities,
  paginate,
  roundRobin,
  type SourceAdapter,
  wantType,
} from "../common.ts";

const BASE = "https://join.qq.com/api/v1";

export interface TencentCampusListItem {
  postId: string;
  positionTitle: string;
  projectId: number;
  projectName: string;
  recruitLabelName?: string;
}

export interface TencentCampusDetail {
  postId: string;
  title: string;
  tidName?: string | null;
  desc?: string | null;
  request?: string | null;
  topicDetail?: string | null;
  topicRequirement?: string | null;
  graduateBonus?: string | null;
  internBonus?: string | null;
  workCityList?: string[] | null;
  projectName?: string | null;
  recruitLabelName?: string | null;
  intentionBGDList?: { showTitle?: string | null }[] | null;
}

export function jobTypeOf(label: string | null | undefined): "internship" | "campus" {
  return /实习/.test(label ?? "") ? "internship" : "campus";
}

export function normalizeTencentCampus(d: TencentCampusDetail, fetchedAt: Date): Job {
  const bgs = (d.intentionBGDList ?? []).map((b) => b.showTitle).filter((x): x is string => !!x);
  return Job.parse({
    id: `tencent_campus:${d.postId}`,
    source: "tencent_campus",
    sourceJobId: d.postId,
    company: "腾讯",
    title: clean(d.title),
    cities: normalizeCities(d.workCityList),
    jobType: jobTypeOf(`${d.projectName} ${d.recruitLabelName}`),
    jdText: joinJd([
      ["岗位职责", d.desc],
      ["任职要求", d.request],
      ["课题内容", d.topicDetail],
      ["课题要求", d.topicRequirement],
      ["加分项", d.graduateBonus || d.internBonus],
    ]),
    url: `https://join.qq.com/post_detail.html?postid=${d.postId}`,
    tags: [d.tidName, ...bgs].filter((x): x is string => !!x),
    fetchedAt,
  });
}

const listBody = (pageIndex: number) => ({
  projectIdList: [],
  projectMappingIdList: [],
  keyword: "",
  bgList: [],
  workCountryType: 0,
  workCityList: [],
  recruitCityList: [],
  positionFidList: [],
  pageIndex,
  pageSize: 100,
});

export const tencentCampus: SourceAdapter = {
  name: "tencent_campus",
  company: "腾讯",
  async *fetch(ctx: FetchContext) {
    // 列表按项目排序，先全量取列表（约 11 页）再按类型轮流取详情，限量时也能覆盖实习与校招
    const items: TencentCampusListItem[] = [];
    for await (const it of paginate(ctx, "tencent_campus 列表", async (n) => {
      const r = await ctx.http.json<{ data: { positionList: TencentCampusListItem[]; count: number } }>(
        `${BASE}/position/searchPosition`,
        {
          json: listBody(n),
        },
      );
      return { items: r.data.positionList, hasMore: n * 100 < r.data.count };
    })) {
      if (wantType(ctx, jobTypeOf(`${it.projectName} ${it.recruitLabelName}`))) items.push(it);
    }
    const byType = new Map<string, TencentCampusListItem[]>();
    for (const it of items) {
      const k = jobTypeOf(`${it.projectName} ${it.recruitLabelName}`);
      byType.set(k, [...(byType.get(k) ?? []), it]);
    }
    async function* details(list: TencentCampusListItem[]) {
      for (const it of list) {
        try {
          const r = await ctx.http.json<{ data: TencentCampusDetail }>(
            `${BASE}/jobDetails/getJobDetailsByPostId?postId=${it.postId}`,
          );
          yield normalizeTencentCampus(r.data, ctx.now());
        } catch (e) {
          ctx.onError(`tencent_campus 详情 ${it.postId} 失败: ${(e as Error).message}`);
        }
      }
    }
    yield* roundRobin([...byType.values()].map(details));
  },
};
