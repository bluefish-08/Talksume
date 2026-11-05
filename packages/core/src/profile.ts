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

export const Link = z.object({
  label: z.string().optional().describe("如 GitHub、博客、作品集"),
  url: z.string(),
});

export const Basics = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  city: z.string().optional(),
  summary: z.string().optional().describe("一句话自我介绍"),
  headline: z
    .string()
    .optional()
    .describe("求职意向行，如「2026 届 · 后端开发工程师 · 校招」；不填时由求职意向推导"),
  links: z.array(Link).optional(),
  photo: z.string().optional().describe("证件照地址，暂不渲染"),
  languages: z.array(z.string()).optional().describe("语言能力，如 CET-6 586、雅思 7.0"),
});

export const Education = Sourced.extend({
  school: z.string(),
  degree: z.enum(["associate", "bachelor", "master", "phd"]).describe("专科/本科/硕士/博士"),
  major: z.string().optional(),
  gpa: z.string().optional(),
  rank: z.string().optional().describe("成绩排名，如 专业前 5%、3/120"),
  city: z.string().optional(),
  courses: z.array(z.string()).default([]),
  honors: z.array(z.string()).optional().describe("在校荣誉与奖学金，一项一条"),
}).extend(Period.shape);

export const Highlight = z.object({
  title: z.string().optional().describe("要点的关键词短语，如「订单链路缓存优化」"),
  detail: z.string().describe("细节，尽量带量化结果"),
});

export const Experience = Sourced.extend({
  kind: z.enum(["internship", "fulltime", "parttime"]),
  company: z.string(),
  department: z.string().optional(),
  title: z.string(),
  city: z.string().optional(),
  techStack: z.array(z.string()).optional(),
  bullets: z.array(z.string()).default([]),
  highlights: z.array(Highlight).optional().describe("有则优先于 bullets"),
}).extend(Period.shape);

export const Project = Sourced.extend({
  name: z.string(),
  kind: z
    .enum(["project", "campus"])
    .optional()
    .describe("campus=社团、学生会、志愿者、学生活动等校园经历，简历上单列「校园经历」；不填即项目"),
  role: z.string().optional(),
  techStack: z.array(z.string()).default([]),
  situation: z.string().optional().describe("STAR：背景"),
  task: z.string().optional().describe("STAR：任务"),
  action: z.string().optional().describe("STAR：本人做了什么"),
  result: z.string().optional().describe("STAR：结果，尽量量化"),
  city: z.string().optional(),
  highlights: z.array(Highlight).optional().describe("有则优先于 STAR"),
}).extend(Period.shape);

export const Skill = Sourced.extend({
  name: z.string(),
  category: z.string().optional().describe("分组，如 编程语言、框架与中间件、数据库、工具、AI 相关"),
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
  showSalary: z
    .boolean()
    .optional()
    .describe("期望薪资是否写上简历，默认不写；只有用户明确要求时才设为 true"),
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
export type Basics = z.infer<typeof Basics>;
export type Highlight = z.infer<typeof Highlight>;
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
