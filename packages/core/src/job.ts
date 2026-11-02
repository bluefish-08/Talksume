import { z } from "zod";
import { JobType } from "./profile.ts";

export const Job = z.object({
  id: z.string(),
  source: z.string().describe("数据源标识，如 hr_workspace、tencent"),
  sourceJobId: z.string(),
  company: z.string(),
  title: z.string(),
  cities: z.array(z.string()).default([]),
  jobType: JobType.optional(),
  salaryMin: z.number().int().nonnegative().optional().describe("月薪下限，单位元"),
  salaryMax: z.number().int().nonnegative().optional(),
  degree: z.enum(["any", "associate", "bachelor", "master", "phd"]).optional(),
  jdText: z.string(),
  url: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  postedAt: z.coerce.date().optional(),
  fetchedAt: z.coerce.date(),
});

export type Job = z.infer<typeof Job>;
