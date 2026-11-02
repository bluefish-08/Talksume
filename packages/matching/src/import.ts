import { z } from "zod";
import { requiredDegree } from "./filters.ts";
import type { StructuredLlm } from "./rerank.ts";

export const UNKNOWN_COMPANY = "未标注公司";

const CITIES = [
  "北京",
  "上海",
  "深圳",
  "广州",
  "杭州",
  "成都",
  "武汉",
  "南京",
  "西安",
  "苏州",
  "天津",
  "重庆",
  "厦门",
  "长沙",
  "郑州",
  "青岛",
  "合肥",
  "福州",
  "济南",
  "珠海",
  "东莞",
];
const COMPANIES = [
  "腾讯",
  "网易",
  "美团",
  "米哈游",
  "字节跳动",
  "阿里巴巴",
  "百度",
  "京东",
  "小米",
  "华为",
  "快手",
  "拼多多",
  "滴滴",
  "蚂蚁集团",
  "哔哩哔哩",
  "小红书",
];

const JOB_TYPES = ["internship", "campus", "experienced"] as const;
const DEGREES = ["any", "associate", "bachelor", "master", "phd"] as const;

export interface ExtractedJob {
  company: string;
  title: string;
  cities: string[];
  jobType?: (typeof JOB_TYPES)[number];
  degree?: (typeof DEGREES)[number];
  salaryMin?: number;
  salaryMax?: number;
  tags: string[];
}

const LlmExtract = z.object({
  company: z.string().nullish().describe("招聘公司名，文中没有写则为空"),
  title: z.string().nullish().describe("岗位名称"),
  cities: z.array(z.string()).nullish().describe("工作城市，只写城市名"),
  jobType: z.enum(JOB_TYPES).nullish().describe("internship 实习 / campus 校招 / experienced 社招"),
  degree: z.enum(DEGREES).nullish().describe("最低学历要求，没写为空"),
  salaryMin: z.number().nullish().describe("月薪下限，单位元，没写为空"),
  salaryMax: z.number().nullish().describe("月薪上限，单位元，没写为空"),
  tags: z.array(z.string()).nullish().describe("技能或方向标签，最多 8 个"),
});

const labelled = (text: string, labels: string) =>
  text.match(new RegExp(`(?:${labels})\\s*[:：]\\s*([^\\n]{1,60})`))?.[1]?.trim();

/** 不依赖大模型的最小抽取：标题取「岗位」字段或第一行，公司/城市/类型靠关键词。 */
export function heuristicExtract(text: string): ExtractedJob {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const first = (lines[0] ?? "").replace(/^[【[#*\s]+|[】\]*\s]+$/g, "");
  const title =
    (labelled(text, "岗位名称|职位名称|招聘岗位|岗位|职位") ?? first).slice(0, 60) || "未命名岗位";

  const company =
    labelled(text, "公司名称|公司|企业|用人单位") ??
    COMPANIES.find((c) => text.includes(c)) ??
    UNKNOWN_COMPANY;

  const cityLine = labelled(text, "工作地点|工作城市|城市|地点|base");
  const cities = CITIES.filter((c) => (cityLine ?? text).includes(c)).slice(0, 6);

  let jobType: ExtractedJob["jobType"];
  if (/实习/.test(title)) jobType = "internship";
  else if (/校招|校园招聘|应届|届毕业生|培训生/.test(text)) jobType = "campus";
  else if (/社招|\d+\s*年以上.{0,6}经验/.test(text)) jobType = "experienced";
  else if (/实习/.test(text)) jobType = "internship";

  const range = text.match(/(\d+(?:\.\d+)?)\s*[kK]\s*[-~–—至到]\s*(\d+(?:\.\d+)?)\s*[kK]/);
  const degree = requiredDegree({ jdText: text })?.degree;

  return {
    company: company.slice(0, 40),
    title,
    cities,
    ...(jobType && { jobType }),
    ...(degree && { degree }),
    ...(range?.[1] &&
      range[2] && {
        salaryMin: Math.round(Number(range[1]) * 1000),
        salaryMax: Math.round(Number(range[2]) * 1000),
      }),
    tags: [],
  };
}

export async function extractJobFields(
  text: string,
  llm?: StructuredLlm | null,
  onError?: (error: unknown) => void,
): Promise<ExtractedJob> {
  const base = heuristicExtract(text);
  if (!llm) return base;
  try {
    const res = await llm.completeStructured({
      purpose: "jd_import",
      system: "你从招聘 JD 原文里抽取结构化字段。只依据原文，原文没写的字段留空，不要猜测。",
      prompt: text.slice(0, 6000),
      schema: z.toJSONSchema(LlmExtract) as Record<string, unknown>,
      validate: (v) => LlmExtract.parse(v),
      signal: AbortSignal.timeout(60_000),
    });
    const v = res.value;
    const company = v.company?.trim();
    const title = v.title?.trim();
    const cities = (v.cities ?? []).map((c) => c.trim().replace(/市$/, "")).filter(Boolean);
    const salaryMin = v.salaryMin && v.salaryMin > 0 ? Math.round(v.salaryMin) : base.salaryMin;
    const salaryMax = v.salaryMax && v.salaryMax > 0 ? Math.round(v.salaryMax) : base.salaryMax;
    const jobType = v.jobType ?? base.jobType;
    const degree = v.degree ?? base.degree;
    return {
      company: company || base.company,
      title: title || base.title,
      cities: cities.length > 0 ? cities : base.cities,
      ...(jobType && { jobType }),
      ...(degree && { degree }),
      ...(salaryMin !== undefined && { salaryMin }),
      ...(salaryMax !== undefined && { salaryMax }),
      tags: (v.tags ?? [])
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 8),
    };
  } catch (error) {
    onError?.(error);
    return base;
  }
}
