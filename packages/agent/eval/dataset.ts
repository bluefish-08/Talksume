import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * 数据集格式（JSONL，每行一个样例）：
 * { "id": "...", "description": "...", "turns": ["用户第 1 句", ...], "expected": { ...期望的画像字段... } }
 *
 * expected 的结构与 Profile 相同，但不含 id / sourceFactIds，且所有字段可省略。取值有三种写法：
 * - 字符串 / 数字：归一化后相等才算对（忽略大小写、空白和标点）；
 * - 字符串数组（techStack、roles、cities 等）：每个元素单独计一项；
 * - { "$contains": ["关键词", ...] }：自由文本字段，预测值包含全部关键词即算对。
 * 列表分区里的条目靠 school / company / name 对齐（两边归一化后相等或互相包含）。
 * 样例中没有写出的字段表示用户没说过，模型若写入则计为误报。
 */
export const Contains = z.object({ $contains: z.array(z.string()).min(1) });
export type Contains = z.infer<typeof Contains>;

const Text = z.union([z.string(), Contains]);
const TextOrList = z.union([z.string(), z.array(z.string()), Contains]);

const Period = { start: z.string().optional(), end: z.string().optional() };

export const ExpectedProfile = z.object({
  basics: z
    .object({
      name: Text.optional(),
      phone: Text.optional(),
      email: Text.optional(),
      city: Text.optional(),
      summary: Text.optional(),
    })
    .optional(),
  education: z
    .array(
      z.object({
        school: z.string(),
        degree: z.string().optional(),
        major: Text.optional(),
        gpa: Text.optional(),
        courses: TextOrList.optional(),
        ...Period,
      }),
    )
    .optional(),
  experiences: z
    .array(
      z.object({
        company: z.string(),
        title: Text.optional(),
        kind: z.string().optional(),
        bullets: TextOrList.optional(),
        ...Period,
      }),
    )
    .optional(),
  projects: z
    .array(
      z.object({
        name: z.string(),
        role: Text.optional(),
        techStack: TextOrList.optional(),
        situation: Text.optional(),
        task: Text.optional(),
        action: Text.optional(),
        result: Text.optional(),
        ...Period,
      }),
    )
    .optional(),
  skills: z.array(z.object({ name: z.string(), level: z.string().optional() })).optional(),
  awards: z
    .array(z.object({ name: z.string(), date: z.string().optional(), description: Text.optional() }))
    .optional(),
  intention: z
    .object({
      roles: TextOrList.optional(),
      cities: TextOrList.optional(),
      jobType: z.string().optional(),
      salaryMin: z.number().optional(),
      salaryMax: z.number().optional(),
      availableFrom: z.string().optional(),
    })
    .optional(),
});
export type ExpectedProfile = z.infer<typeof ExpectedProfile>;

export const Sample = z.object({
  id: z.string(),
  description: z.string(),
  turns: z.array(z.string().min(1)).min(1),
  expected: ExpectedProfile,
});
export type Sample = z.infer<typeof Sample>;

export function parseDataset(jsonl: string): Sample[] {
  return jsonl
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"))
    .map((line, index) => {
      const parsed = Sample.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(`数据集第 ${index + 1} 行格式错误：${parsed.error.issues[0]?.message ?? "unknown"}`);
      }
      return parsed.data;
    });
}

export function loadDataset(path: string): Sample[] {
  return parseDataset(readFileSync(path, "utf8"));
}
