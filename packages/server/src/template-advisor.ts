import {
  ACCENT_INFO,
  type Profile,
  RESUME_ACCENTS,
  RESUME_TEMPLATES,
  ResumeStyle,
  TEMPLATE_INFO,
} from "@talksume/core";
import type { Gateway } from "@talksume/llm-gateway";
import { z } from "zod";

export const TemplateAdvice = ResumeStyle.extend({
  reason: z
    .string()
    .trim()
    .min(1)
    .transform((r) => r.slice(0, 60)),
});
export type TemplateAdvice = z.infer<typeof TemplateAdvice>;

/** 只在固定的模板 × 强调色里挑，不让模型产出 CSS：PDF/Word 一致性和 ATS 解析都靠固定模板兜底。 */
export type TemplateAdvisor = (profile: Profile, signal?: AbortSignal) => Promise<TemplateAdvice>;

const JOB_TYPE_LABEL = { internship: "实习", campus: "校招", experienced: "社招" } as const;
const DEGREE_LABEL = { associate: "专科", bachelor: "本科", master: "硕士", phd: "博士" } as const;

/** 只给模型看方向信息，不带姓名、联系方式、学校和公司名。 */
export function profileDigest(profile: Profile): string {
  const { intention, education, experiences, projects, skills, awards } = profile;
  const lines = [
    intention.roles.length ? `求职意向：${intention.roles.join("、")}` : "",
    intention.jobType ? `求职类型：${JOB_TYPE_LABEL[intention.jobType]}` : "",
    education.length
      ? `专业：${education.map((e) => [e.major, DEGREE_LABEL[e.degree]].filter(Boolean).join(" ")).join("；")}`
      : "",
    experiences.length ? `经历岗位：${experiences.map((e) => e.title).join("、")}` : "",
    projects.length
      ? `项目：${projects.map((p) => [p.role, p.techStack.join("/")].filter(Boolean).join(" ") || "未注明角色").join("；")}`
      : "",
    skills.length ? `技能：${skills.map((s) => s.name).join("、")}` : "",
    awards.length ? `获奖 ${awards.length} 项` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

const SYSTEM = [
  "你是校招简历的版式顾问，只从给定的模板和强调色里挑一个组合，不设计新样式。",
  "模板：",
  ...RESUME_TEMPLATES.map((t) => `- ${t}（${TEMPLATE_INFO[t].label}）：${TEMPLATE_INFO[t].hint}`),
  "强调色：",
  ...RESUME_ACCENTS.map((a) => `- ${a}（${ACCENT_INFO[a].label}）`),
  "参考：技术研发岗内容多时偏向 tech；外企、金融、咨询、法务偏向 minimal 配 ink；产品、运营、市场、设计偏向 modern；方向不明或内容少时用 campus 配 blue。",
  "reason 用一句中文说明为什么适合这位同学，不超过 40 字，只依据给出的信息，不要编造经历。",
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    template: { type: "string", enum: [...RESUME_TEMPLATES] },
    accent: { type: "string", enum: [...RESUME_ACCENTS] },
    reason: { type: "string", maxLength: 60 },
  },
  required: ["template", "accent", "reason"],
  additionalProperties: false,
};

export function gatewayTemplateAdvisor(gateway: Pick<Gateway, "completeStructured">): TemplateAdvisor {
  return async (profile, signal) => {
    const { value } = await gateway.completeStructured({
      purpose: "template",
      system: SYSTEM,
      prompt: profileDigest(profile),
      schema: SCHEMA,
      validate: (v) => TemplateAdvice.parse(v),
      maxTokens: 400,
      ...(signal && { signal }),
    });
    return value;
  };
}
