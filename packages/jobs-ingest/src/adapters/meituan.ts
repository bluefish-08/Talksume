import { Job } from "@talksume/core";
import {
  clean,
  degreeFromJd,
  type FetchContext,
  type JobType,
  joinJd,
  normalizeCities,
  paginate,
  parseTime,
  roundRobin,
  type SourceAdapter,
  wantType,
} from "../common.ts";

const API = "https://zhaopin.meituan.com/api/official/job/getJobList";
const PAGE_SIZE = 50;

export interface MeituanJob {
  jobUnionId: string;
  name: string;
  jobType: string;
  jobFamily?: string | null;
  jobFamilyGroup?: string | null;
  cityList?: { name?: string | null }[] | null;
  department?: { name?: string | null }[] | null;
  jobDuty?: string | null;
  jobRequirement?: string | null;
  highLight?: string | null;
  firstPostTime?: number | null;
  refreshTime?: number | null;
}

const TYPES: Record<string, { type: JobType; highlight: string }> = {
  "1": { type: "campus", highlight: "campus" },
  "2": { type: "internship", highlight: "internship" },
  "3": { type: "experienced", highlight: "social" },
};

export function normalizeMeituan(p: MeituanJob, fetchedAt: Date): Job | undefined {
  const t = TYPES[p.jobType];
  if (!t) return undefined;
  return Job.parse({
    id: `meituan:${p.jobUnionId}`,
    source: "meituan",
    sourceJobId: p.jobUnionId,
    company: "美团",
    title: clean(p.name),
    cities: normalizeCities((p.cityList ?? []).map((c) => c.name ?? "")),
    jobType: t.type,
    degree: degreeFromJd(p.jobRequirement),
    jdText: joinJd([
      ["岗位职责", p.jobDuty],
      ["任职要求", p.jobRequirement],
      ["岗位亮点", p.highLight],
    ]),
    url: `https://zhaopin.meituan.com/web/position/detail?jobUnionId=${p.jobUnionId}&highlightType=${t.highlight}`,
    tags: [p.jobFamily, p.jobFamilyGroup, ...(p.department ?? []).map((d) => d.name)].filter(
      (x): x is string => !!x,
    ),
    postedAt: parseTime(p.firstPostTime ?? p.refreshTime),
    fetchedAt,
  });
}

export const meituan: SourceAdapter = {
  name: "meituan",
  company: "美团",
  async *fetch(ctx: FetchContext) {
    const codes = Object.entries(TYPES).filter(([, t]) => wantType(ctx, t.type));
    const streams = codes.map(async function* ([code]) {
      const list = paginate(ctx, `meituan jobType=${code}`, async (n) => {
        const r = await ctx.http.json<{ data: { list: MeituanJob[]; page: { totalPage: number } } }>(API, {
          json: {
            page: { pageNo: n, pageSize: PAGE_SIZE },
            jobShareType: "1",
            keywords: "",
            cityList: [],
            department: [],
            jfJgList: [],
            jobType: [{ code, subCode: [] }],
            typeCode: [],
            specialCode: [],
          },
        });
        return { items: r.data.list ?? [], hasMore: n < r.data.page.totalPage };
      });
      for await (const p of list) {
        const job = normalizeMeituan(p, ctx.now());
        if (job) yield job;
      }
    });
    yield* roundRobin(streams);
  },
};
