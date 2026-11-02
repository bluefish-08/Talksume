import { z } from "zod";

export const ResumeBullet = z.object({
  text: z.string(),
  factIds: z.array(z.string()).default([]),
});

export const ResumeItem = z.object({
  heading: z.string(),
  subheading: z.string().optional(),
  period: z.string().optional().describe("已格式化的时间段，如 2025.07 – 2025.09"),
  bullets: z.array(ResumeBullet).default([]),
});

export const ResumeSection = z.object({
  kind: z.enum(["education", "experiences", "projects", "skills", "awards", "custom"]),
  title: z.string(),
  items: z.array(ResumeItem).default([]),
});

export const ResumeContent = z.object({
  basics: z.object({
    name: z.string(),
    contacts: z.array(z.string()).default([]).describe("电话、邮箱、城市等，按显示顺序"),
    summary: z.string().optional(),
  }),
  sections: z.array(ResumeSection),
});

export type ResumeBullet = z.infer<typeof ResumeBullet>;
export type ResumeItem = z.infer<typeof ResumeItem>;
export type ResumeSection = z.infer<typeof ResumeSection>;
export type ResumeContent = z.infer<typeof ResumeContent>;
