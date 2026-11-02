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

const BASE = "https://ats.openout.mihoyo.com/ats-portal/v1";
const CHANNEL = { channelDetailIds: [1], hireType: 1 };

export interface MihoyoListItem {
  id: string;
  title: string;
  jobNature?: string | null;
  projectName?: string | null;
}

export interface MihoyoDetail extends MihoyoListItem {
  addressDetailList?: { addressDetail?: string | null }[] | null;
  competencyType?: string | null;
  description?: string | null;
  jobRequire?: string | null;
  addition?: string | null;
  deliveryInstructions?: string | null;
  objectName?: string | null;
}

export function jobTypeOf(d: Pick<MihoyoListItem, "jobNature" | "projectName">): "internship" | "campus" {
  return /实习/.test(`${d.jobNature ?? ""}${d.projectName ?? ""}`) ? "internship" : "campus";
}

export function normalizeMihoyo(d: MihoyoDetail, fetchedAt: Date): Job {
  const type = jobTypeOf(d);
  return Job.parse({
    id: `mihoyo:${d.id}`,
    source: "mihoyo",
    sourceJobId: String(d.id),
    company: "米哈游",
    title: clean(d.title),
    cities: normalizeCities((d.addressDetailList ?? []).map((a) => a.addressDetail ?? "")),
    jobType: type,
    jdText: joinJd([
      ["岗位职责", d.description],
      ["任职要求", d.jobRequire],
      ["加分项", d.addition],
      [type === "internship" ? "实习要求" : "补充说明", d.deliveryInstructions],
    ]),
    url: `https://jobs.mihoyo.com/#/campus/position/${d.id}`,
    tags: [d.competencyType, d.projectName].filter((x): x is string => !!x),
    fetchedAt,
  });
}

// 仅校园招聘频道（channelDetailIds=[1]）无需登录；社招频道的列表为空，未采集
export const mihoyo: SourceAdapter = {
  name: "mihoyo",
  company: "米哈游",
  async *fetch(ctx: FetchContext) {
    const list = paginate(ctx, "mihoyo 列表", async (n) => {
      const r = await ctx.http.json<{ data: { list: MihoyoListItem[]; total: number } }>(`${BASE}/job/list`, {
        json: { pageNo: n, pageSize: 50, ...CHANNEL, orderBy: "", isTop: false },
      });
      return { items: r.data.list ?? [], hasMore: n * 50 < r.data.total };
    });
    for await (const it of list) {
      if (!wantType(ctx, jobTypeOf(it))) continue;
      try {
        const r = await ctx.http.json<{ data: MihoyoDetail }>(`${BASE}/job/info`, {
          json: { id: it.id, ...CHANNEL },
        });
        yield normalizeMihoyo(r.data, ctx.now());
      } catch (e) {
        ctx.onError(`mihoyo 详情 ${it.id} 失败: ${(e as Error).message}`);
      }
    }
  },
};
