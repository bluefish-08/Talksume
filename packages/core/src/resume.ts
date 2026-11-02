import { z } from "zod";

export const ResumeBullet = z.object({
  lead: z.string().optional().describe("加粗的关键词短语，渲染为「lead：text」"),
  text: z.string().describe("要点正文；数字指标渲染时自动加粗，也可用 **…** 显式标出需要加粗的片段"),
  factIds: z.array(z.string()).default([]),
});

export const ResumeItem = z.object({
  heading: z.string(),
  subheading: z.string().optional(),
  period: z.string().optional().describe("已格式化的时间段，如 2025.07 – 2025.09"),
  meta: z.string().optional().describe("时间右侧的补充信息，目前是城市"),
  techStack: z.array(z.string()).optional(),
  bullets: z.array(ResumeBullet).default([]),
});

export const ResumeSection = z.object({
  kind: z.enum(["education", "experiences", "projects", "skills", "awards", "custom"]),
  title: z.string(),
  items: z.array(ResumeItem).default([]),
});

export const ResumeLink = z.object({
  label: z.string().optional(),
  url: z.string(),
});

export const ResumeContent = z.object({
  basics: z.object({
    name: z.string(),
    headline: z.string().optional().describe("求职意向行"),
    contacts: z.array(z.string()).default([]).describe("城市、电话、邮箱等，按显示顺序"),
    links: z.array(ResumeLink).optional(),
    photo: z.string().optional(),
    summary: z.string().optional(),
  }),
  sections: z.array(ResumeSection),
});

export type ResumeBullet = z.infer<typeof ResumeBullet>;
export type ResumeItem = z.infer<typeof ResumeItem>;
export type ResumeSection = z.infer<typeof ResumeSection>;
export type ResumeLink = z.infer<typeof ResumeLink>;
export type ResumeContent = z.infer<typeof ResumeContent>;
