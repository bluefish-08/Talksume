import { z } from "zod";

const YearMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe("年月，格式 YYYY-MM");

const Period = z.object({
  start: YearMonth.optional(),
  end: z
    .union([YearMonth, z.literal("present")])
    .optional()
    .describe("结束年月，至今填 present"),
});

const Sourced = z.object({
  id: z.string(),
  sourceFactIds: z.array(z.string()).default([]).describe("支撑该条目的事实 ID，用于防编造溯源"),
});

export const Basics = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  city: z.string().optional(),
  summary: z.string().optional().describe("一句话自我介绍"),
});

export const Education = Sourced.extend({
  school: z.string(),
  degree: z.enum(["associate", "bachelor", "master", "phd"]).describe("专科/本科/硕士/博士"),
  major: z.string().optional(),
  gpa: z.string().optional(),
  courses: z.array(z.string()).default([]),
}).extend(Period.shape);

export const Experience = Sourced.extend({
  kind: z.enum(["internship", "fulltime", "parttime"]),
  company: z.string(),
  title: z.string(),
  bullets: z.array(z.string()).default([]),
}).extend(Period.shape);

export const Project = Sourced.extend({
  name: z.string(),
  role: z.string().optional(),
  techStack: z.array(z.string()).default([]),
  situation: z.string().optional().describe("STAR：背景"),
  task: z.string().optional().describe("STAR：任务"),
  action: z.string().optional().describe("STAR：本人做了什么"),
  result: z.string().optional().describe("STAR：结果，尽量量化"),
}).extend(Period.shape);

export const Skill = Sourced.extend({
  name: z.string(),
  level: z
    .enum(["beginner", "familiar", "proficient", "expert"])
    .optional()
    .describe(
      "熟练度，仅在用户明确说了程度时填：了解/入门→beginner，熟悉→familiar，熟练/擅长→proficient，精通→expert；没说就不要填",
    ),
});

export const Award = Sourced.extend({
  name: z.string(),
  date: YearMonth.optional(),
  description: z.string().optional(),
});

export const JobType = z.enum(["internship", "campus", "experienced"]).describe("实习/校招/社招");

export const Intention = z.object({
  roles: z.array(z.string()).default([]),
  cities: z.array(z.string()).default([]),
  jobType: JobType.optional(),
  salaryMin: z.number().int().nonnegative().optional().describe("期望月薪下限，单位元"),
  salaryMax: z.number().int().nonnegative().optional(),
  availableFrom: YearMonth.optional(),
});

export const Profile = z.object({
  basics: Basics.default({}),
  education: z.array(Education).default([]),
  experiences: z.array(Experience).default([]),
  projects: z.array(Project).default([]),
  skills: z.array(Skill).default([]),
  awards: z.array(Award).default([]),
  intention: Intention.default({ roles: [], cities: [] }),
});

export type Profile = z.infer<typeof Profile>;
export type Education = z.infer<typeof Education>;
export type Experience = z.infer<typeof Experience>;
export type Project = z.infer<typeof Project>;
export type Skill = z.infer<typeof Skill>;
export type Award = z.infer<typeof Award>;
export type Intention = z.infer<typeof Intention>;
export type JobType = z.infer<typeof JobType>;

export const PROFILE_SECTIONS = [
  "basics",
  "education",
  "experiences",
  "projects",
  "skills",
  "awards",
  "intention",
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export const Fact = z.object({
  id: z.string(),
  section: z.enum(PROFILE_SECTIONS),
  payload: z.record(z.string(), z.unknown()),
  quote: z.string().describe("用户原话片段"),
  sourceMessageId: z.string(),
  status: z.enum(["pending", "confirmed", "superseded"]),
});
export type Fact = z.infer<typeof Fact>;
