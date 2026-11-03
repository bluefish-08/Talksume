import {
  Award,
  Basics,
  Education,
  Experience,
  Intention,
  PROFILE_SECTIONS,
  type ProfileSection,
  Project,
  Skill,
} from "@talksume/core";
import { z } from "zod";

const OMIT_IDS = { id: true, sourceFactIds: true } as const;

export const HighlightInput = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .describe("4～10 字的关键词短语，概括这条要点，如「订单查询重构」「缓存一致性」"),
  detail: z.string().trim().min(1).describe("照用户原话写的细节，不改写、不夸大；数字只能用用户说过的"),
});

const TechStack = z.array(z.string()).describe("这段经历用到的技术、框架、工具，一项一条");
const Highlights = z
  .array(HighlightInput)
  .describe("经历要点：用户讲的职责、难点与做法、结果，各整理成一条；补充已有要点时沿用原 title");

/** 事实 payload 的校验 schema：条目分区只强制要求能定位条目的键，其余字段可分批补充。 */
export const SectionPayload = {
  basics: Basics.omit({ headline: true, photo: true }),
  education: Education.omit(OMIT_IDS).partial().required({ school: true }),
  experiences: Experience.omit(OMIT_IDS)
    .partial()
    .required({ company: true })
    .extend({ techStack: TechStack.optional(), highlights: Highlights.optional() }),
  projects: Project.omit(OMIT_IDS)
    .partial()
    .required({ name: true })
    .extend({ techStack: TechStack.optional(), highlights: Highlights.optional() }),
  skills: Skill.omit(OMIT_IDS),
  awards: Award.omit(OMIT_IDS),
  intention: Intention.partial(),
} as const satisfies Record<ProfileSection, z.ZodType>;

const Quote = z
  .string()
  .trim()
  .min(1)
  .describe("用户原话片段，逐字摘抄不要改写；依据分散在不相邻的几处时，各段用 … 连接，每段至少两个字");

function factVariant<S extends ProfileSection>(section: S) {
  return z.object({
    section: z.literal(section),
    payload: SectionPayload[section],
    quote: Quote,
  });
}

export const FactInput = z.discriminatedUnion("section", [
  factVariant("basics"),
  factVariant("education"),
  factVariant("experiences"),
  factVariant("projects"),
  factVariant("skills"),
  factVariant("awards"),
  factVariant("intention"),
]);
export type FactInput = z.infer<typeof FactInput>;

export const UpsertFactsArgs = z.object({
  facts: z.array(FactInput).min(1).describe("一句话包含多个事实时批量写入；每条事实只含用户明确说过的信息"),
});
export type UpsertFactsArgs = z.infer<typeof UpsertFactsArgs>;

export const AskUserArgs = z.object({
  question: z.string().trim().min(1).describe("向用户提出的一个具体问题，口语化、一次只问一件事"),
  quickReplies: z
    .array(z.string())
    .optional()
    .describe(
      "2 到 4 条用户可一键发送的简短回答（每条 12 字以内，第一人称），如「是独立完成的」「跳过这个」；只给用户确实可能这样回答的选项，不确定就省略",
    ),
});
export type AskUserArgs = z.infer<typeof AskUserArgs>;

export const MAX_QUICK_REPLIES = 4;
export const MAX_QUICK_REPLY_LENGTH = 20;

/** 去空、去重、截断；不足 2 条视为模型没给。 */
export function cleanQuickReplies(raw: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const item of raw ?? []) {
    const text = item.trim();
    if (text && text.length <= MAX_QUICK_REPLY_LENGTH) seen.add(text);
  }
  const list = [...seen].slice(0, MAX_QUICK_REPLIES);
  return list.length >= 2 ? list : [];
}

export const CompleteSectionArgs = z.object({
  section: z.enum(PROFILE_SECTIONS),
  reason: z
    .enum(["done", "user_skipped"])
    .default("done")
    .describe("done=该分区信息已足够；user_skipped=用户明确表示没有或不想提供"),
  quote: z.string().optional().describe("reason 为 user_skipped 时必填：用户表示没有/不想提供的原话"),
});
export type CompleteSectionArgs = z.infer<typeof CompleteSectionArgs>;

export const SkipFieldArgs = z.object({
  key: z
    .string()
    .optional()
    .describe("要跳过的字段 key，见「当前目标字段」或 upsert_facts 返回的下一个目标；不传则跳过当前目标字段"),
  quote: Quote.describe("用户表示没有/不想说的原话，如「GPA 不想说」「没有个人网站」"),
});
export type SkipFieldArgs = z.infer<typeof SkipFieldArgs>;

export const ResolveConflictArgs = z.object({
  factId: z.string().optional().describe("待确认矛盾的 factId，见系统提示里的矛盾列表"),
  field: z.string().optional().describe("没有 factId 时用矛盾所在字段名定位，如 situation"),
  choice: z.enum(["proposed", "previous"]).describe("proposed=采用新说法；previous=保留原来的"),
  quote: Quote.describe("用户表示选哪个的原话，如「用原来的」「新的对」"),
});
export type ResolveConflictArgs = z.infer<typeof ResolveConflictArgs>;

export const MAX_JOB_RESULTS = 5;

const JobTypeArg = z
  .enum(["internship", "campus", "experienced"])
  .optional()
  .describe("internship=实习，campus=校招，experienced=社招；用户没提就不传");
const JobLimit = z.number().int().optional().describe(`返回几个，默认 3，最多 ${MAX_JOB_RESULTS}`);

export const RecommendJobsArgs = z.object({
  city: z.string().trim().optional().describe("只看某个城市时传，如「上海」"),
  jobType: JobTypeArg,
  keyword: z.string().trim().optional().describe("岗位方向关键词，如「后端」「算法」；用户没限定方向就不传"),
  limit: JobLimit,
});
export type RecommendJobsArgs = z.infer<typeof RecommendJobsArgs>;

export const SearchJobsArgs = z.object({
  query: z.string().trim().min(1).describe("岗位关键词，如「后台开发」「数据分析」，不要把公司名写进来"),
  company: z.string().trim().optional().describe("公司名，如「腾讯」"),
  city: z.string().trim().optional(),
  jobType: JobTypeArg,
  limit: JobLimit,
});
export type SearchJobsArgs = z.infer<typeof SearchJobsArgs>;

export const ExplainJobArgs = z.object({
  jobId: z.string().trim().min(1).describe("岗位 id，取自之前 recommend_jobs / search_jobs 返回的 jobId"),
});
export type ExplainJobArgs = z.infer<typeof ExplainJobArgs>;

export const TailorResumeArgs = z.object({
  jobId: z
    .string()
    .trim()
    .min(1)
    .describe("岗位 id，取自之前 recommend_jobs / search_jobs / explain_job 返回的 jobId"),
});
export type TailorResumeArgs = z.infer<typeof TailorResumeArgs>;

export type ToolName =
  | "upsert_facts"
  | "ask_user"
  | "complete_section"
  | "skip_field"
  | "resolve_conflict"
  | "recommend_jobs"
  | "search_jobs"
  | "explain_job"
  | "tailor_resume";

export const JOB_TOOL_NAMES: readonly ToolName[] = [
  "recommend_jobs",
  "search_jobs",
  "explain_job",
  "tailor_resume",
];

export interface ToolSpec {
  name: ToolName;
  description: string;
  schema: z.ZodType;
}

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "upsert_facts",
    description:
      "把用户在对话中明确说出的信息写入画像。每条事实必须附带 quote（用户原话）。不要写入用户没说过的内容。",
    schema: UpsertFactsArgs,
  },
  {
    name: "ask_user",
    description:
      "向用户追问下一个问题，可附带 quickReplies 作为用户的快捷回答。调用后本轮对话结束，等待用户回答。每轮最多调用一次。",
    schema: AskUserArgs,
  },
  {
    name: "complete_section",
    description: "标记某个分区已收集完成，或用户明确表示该分区没有内容。",
    schema: CompleteSectionArgs,
  },
  {
    name: "skip_field",
    description:
      "用户对某一项明确说没有或不想说时调用（如「成绩不想说」）。跳过的项以后的会话都不会再问；整个分区都没有时改用 complete_section。",
    schema: SkipFieldArgs,
  },
  {
    name: "resolve_conflict",
    description:
      "用户用文字回答了待确认的矛盾（如「用原来的」「新的对」）时调用，按用户的选择消解矛盾。用户没明确选哪个时不要调用。",
    schema: ResolveConflictArgs,
  },
  {
    name: "recommend_jobs",
    description:
      "按用户画像取推荐岗位（已按匹配度排序），可按城市、求职类型、方向关键词收窄。用户让你推荐岗位、问「我适合什么」时调用。结果会以卡片展示给用户。",
    schema: RecommendJobsArgs,
  },
  {
    name: "search_jobs",
    description:
      "在全部在招岗位里搜索，不受推荐门槛限制。用户问某家公司、某个具体岗位时调用：公司名放 company，岗位关键词放 query。结果会以卡片展示给用户。",
    schema: SearchJobsArgs,
  },
  {
    name: "explain_job",
    description:
      "解读用户和某个岗位的匹配情况：匹配度、优势、短板和投递前可以补充什么。用户问「我差在哪」「这个岗位怎么样」「第二个呢」时调用，jobId 取自之前的岗位结果；不知道 jobId 时先用 search_jobs 找到。",
    schema: ExplainJobArgs,
  },
  {
    name: "tailor_resume",
    description:
      "针对某个岗位生成一份定制版简历草稿：只调整要点顺序、措辞侧重、技能展示顺序和一句摘要，不新增任何事实，主简历不变。用户说「帮我针对这个岗位改一下简历」「让简历更适配美团那个」时调用，jobId 取自之前的岗位结果；不知道 jobId 时先用 search_jobs 找到。草稿要用户点卡片确认后才生效。",
    schema: TailorResumeArgs,
  },
];

export function toolJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: "input", target: "draft-7" }) as Record<
    string,
    unknown
  >;
  return rest;
}

export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
