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

/** 事实 payload 的校验 schema：条目分区只强制要求能定位条目的键，其余字段可分批补充。 */
export const SectionPayload = {
  basics: Basics,
  education: Education.omit(OMIT_IDS).partial().required({ school: true }),
  experiences: Experience.omit(OMIT_IDS).partial().required({ company: true }),
  projects: Project.omit(OMIT_IDS).partial().required({ name: true }),
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

export const ResolveConflictArgs = z.object({
  factId: z.string().optional().describe("待确认矛盾的 factId，见系统提示里的矛盾列表"),
  field: z.string().optional().describe("没有 factId 时用矛盾所在字段名定位，如 situation"),
  choice: z.enum(["proposed", "previous"]).describe("proposed=采用新说法；previous=保留原来的"),
  quote: Quote.describe("用户表示选哪个的原话，如「用原来的」「新的对」"),
});
export type ResolveConflictArgs = z.infer<typeof ResolveConflictArgs>;

export interface ToolSpec {
  name: "upsert_facts" | "ask_user" | "complete_section" | "resolve_conflict";
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
    name: "resolve_conflict",
    description:
      "用户用文字回答了待确认的矛盾（如「用原来的」「新的对」）时调用，按用户的选择消解矛盾。用户没明确选哪个时不要调用。",
    schema: ResolveConflictArgs,
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
