import { Job } from "@talksume/core";
import {
  clean,
  degreeFromJd,
  type FetchContext,
  type JobType,
  joinJd,
  normalizeCities,
  paginate,
  parseDegree,
  parseTime,
  roundRobin,
  type SourceAdapter,
  wantType,
} from "../common.ts";

const API = "https://hr.163.com/api/hr163/position/queryPage";
const PAGE_SIZE = 50;

export interface NeteasePosition {
  id: number | string;
  name: string;
  workType: string;
  firstPostTypeName?: string | null;
  firstDepName?: string | null;
  productName?: string | null;
  description?: string | null;
  requirement?: string | null;
  reqEducationName?: string | null;
  workPlaceNameList?: string[] | string | null;
  updateTime?: number | null;
}

// 0 社招、1 实习；2 为外包派遣，不属于官方直招，不采集
const WORK_TYPES: [string, JobType][] = [
  ["1", "internship"],
  ["0", "experienced"],
];

export function normalizeNetease(p: NeteasePosition, fetchedAt: Date): Job | undefined {
  const jobType = WORK_TYPES.find(([w]) => w === String(p.workType))?.[1];
  if (!jobType) return undefined;
  const id = String(p.id);
  return Job.parse({
    id: `netease:${id}`,
    source: "netease",
    sourceJobId: id,
    company: "网易",
    title: clean(p.name),
    cities: normalizeCities(p.workPlaceNameList),
    jobType,
    degree: parseDegree(p.reqEducationName) ?? degreeFromJd(p.requirement),
    jdText: joinJd([
      ["岗位职责", p.description],
      ["任职要求", p.requirement],
    ]),
    url: `https://hr.163.com/job-detail.html?id=${id}`,
    tags: [p.firstPostTypeName, p.firstDepName, p.productName].filter((x): x is string => !!x),
    postedAt: parseTime(p.updateTime),
    fetchedAt,
  });
}

export const netease: SourceAdapter = {
  name: "netease",
  company: "网易",
  async *fetch(ctx: FetchContext) {
    const streams = WORK_TYPES.filter(([, t]) => wantType(ctx, t)).map(async function* ([workType]) {
      const list = paginate(ctx, `netease workType=${workType}`, async (n) => {
        const r = await ctx.http.json<{ data: { pages: number; list: NeteasePosition[] } }>(API, {
          json: { currentPage: n, pageSize: PAGE_SIZE, keyword: "", workType },
        });
        return { items: r.data.list ?? [], hasMore: n < r.data.pages };
      });
      for await (const p of list) {
        const job = normalizeNetease(p, ctx.now());
        if (job) yield job;
      }
    });
    yield* roundRobin(streams);
  },
};
