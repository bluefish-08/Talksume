import type { JobInput } from "./types.ts";

export interface JobFormValues {
  title: string;
  company: string;
  cities: string;
  jobType: string;
  salaryMin: string;
  salaryMax: string;
  degree: string;
  jdText: string;
  tags: string;
  url: string;
}

export type JobFormErrors = Partial<Record<keyof JobFormValues, string>>;

const splitList = (raw: string) =>
  raw
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const JOB_TYPES = ["internship", "campus", "experienced"] as const;
const DEGREES = ["any", "associate", "bachelor", "master", "phd"] as const;

function parseK(raw: string): number | "invalid" | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return Math.round(n * 1000);
}

/** 月薪在表单里按「千元」填，提交时换成元。 */
export function buildJobInput(v: JobFormValues): { input: JobInput } | { errors: JobFormErrors } {
  const errors: JobFormErrors = {};
  const title = v.title.trim();
  const company = v.company.trim();
  const jdText = v.jdText.trim();
  if (!title) errors.title = "请填写岗位名称";
  if (!company) errors.company = "请填写公司名称";
  if (!jdText) errors.jdText = "请填写岗位职责与要求";

  const min = parseK(v.salaryMin);
  const max = parseK(v.salaryMax);
  if (min === "invalid") errors.salaryMin = "请填写不小于 0 的数字";
  if (max === "invalid") errors.salaryMax = "请填写不小于 0 的数字";
  if (typeof min === "number" && typeof max === "number" && min > max) {
    errors.salaryMax = "上限不能低于下限";
  }

  const url = v.url.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
    } catch {
      errors.url = "请填写以 http:// 或 https:// 开头的完整链接";
    }
  }

  if (Object.keys(errors).length > 0) return { errors };

  const input: JobInput = { title, company, cities: splitList(v.cities), jdText, tags: splitList(v.tags) };
  const jobType = JOB_TYPES.find((t) => t === v.jobType);
  if (jobType) input.jobType = jobType;
  const degree = DEGREES.find((d) => d === v.degree);
  if (degree) input.degree = degree;
  if (typeof min === "number") input.salaryMin = min;
  if (typeof max === "number") input.salaryMax = max;
  if (url) input.url = url;
  return { input };
}
