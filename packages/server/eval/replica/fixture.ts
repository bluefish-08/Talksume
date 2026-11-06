import { type ResumeContent, ResumeContent as ResumeContentSchema } from "@talksume/core";
import { sampleResume } from "@talksume/resume-render";

// 评测里所有参考图和复刻结果用同一份虚构内容，对比时只剩样式差异
export const evalResume: ResumeContent = ResumeContentSchema.parse({
  ...sampleResume,
  basics: {
    ...sampleResume.basics,
    name: "陈一鸣",
    contacts: ["江城", "138-0000-0000", "chenyiming@example.com"],
    links: [{ label: "GitHub", url: "https://github.com/example-cym" }],
  },
});
