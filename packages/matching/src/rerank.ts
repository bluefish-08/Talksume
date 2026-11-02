import type { Profile } from "@talksume/core";
import type { Gateway } from "@talksume/llm-gateway";
import { z } from "zod";
import { DIMENSION_LABELS, DIMENSIONS, type ScoredJob } from "./types.ts";

export type StructuredLlm = Pick<Gateway, "completeStructured">;

export const MatchReportSchema = z.object({
  summary: z.string().describe("一句话总结匹配度，不超过 60 字"),
  strengths: z.array(z.string()).describe("候选人相对该岗位的优势，2-4 条，每条不超过 40 字"),
  gaps: z.array(z.string()).describe("与岗位要求的差距及可补足的方向，2-4 条，每条不超过 40 字"),
});
export type MatchReportOutput = z.infer<typeof MatchReportSchema>;

const SYSTEM = [
  "你是校园招聘顾问，为学生解释岗位匹配结果。",
  "只依据下面提供的候选人画像、岗位描述和规则打分证据写作，不要编造画像里没有的经历、技能或成绩。",
  "用简体中文，语气务实，直接指出差距。",
].join("\n");

function compactProfile(profile: Profile) {
  return {
    education: profile.education.map((e) => ({ school: e.school, degree: e.degree, major: e.major })),
    skills: profile.skills.map((s) => s.name),
    experiences: profile.experiences.map((e) => ({
      company: e.company,
      title: e.title,
      bullets: e.bullets.slice(0, 4),
    })),
    projects: profile.projects.map((p) => ({
      name: p.name,
      role: p.role,
      techStack: p.techStack,
      action: p.action,
      result: p.result,
    })),
    intention: profile.intention,
  };
}

export function buildRerankPrompt(profile: Profile, scored: ScoredJob): string {
  const { job } = scored;
  const dims = DIMENSIONS.filter((k) => scored.dims[k].applicable).map((k) => ({
    dimension: DIMENSION_LABELS[k],
    score: Math.round(scored.dims[k].score * 100),
    evidence: scored.dims[k].evidence,
  }));
  return [
    `【候选人画像】\n${JSON.stringify(compactProfile(profile))}`,
    `【岗位】${job.company} · ${job.title}（${job.cities.join("/")}）\n${job.jdText.slice(0, 1800)}`,
    `【规则打分】总分 ${scored.score}\n${JSON.stringify(dims)}`,
    "请输出匹配报告 JSON：summary、strengths、gaps。",
  ].join("\n\n");
}

export interface RerankOptions {
  topN?: number;
  concurrency?: number;
  timeoutMs?: number;
  onError?: (error: unknown, jobId: string) => void;
}

export interface JobReport {
  jobId: string;
  report: MatchReportOutput;
  model: string;
}

/** 只给规则分最高的 N 个岗位生成报告；单个失败只丢掉那一条，不影响其余结果。 */
export async function generateReports(
  llm: StructuredLlm,
  profile: Profile,
  ranked: ScoredJob[],
  opts: RerankOptions = {},
): Promise<JobReport[]> {
  const targets = ranked.slice(0, opts.topN ?? 10);
  const results: JobReport[] = [];
  const schema = z.toJSONSchema(MatchReportSchema) as Record<string, unknown>;
  let cursor = 0;

  const worker = async () => {
    while (cursor < targets.length) {
      const scored = targets[cursor++];
      if (!scored) return;
      try {
        const res = await llm.completeStructured({
          purpose: "match_report",
          system: SYSTEM,
          prompt: buildRerankPrompt(profile, scored),
          schema,
          validate: (v) => MatchReportSchema.parse(v),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
          temperature: 0.2,
        });
        results.push({ jobId: scored.job.id, report: res.value, model: res.model });
      } catch (error) {
        opts.onError?.(error, scored.job.id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, targets.length) }, worker));
  return results;
}
