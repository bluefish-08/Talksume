import type { Profile } from "@talksume/core";
import { type Gateway, LlmUnrecoverableError } from "@talksume/llm-gateway";
import { z } from "zod";
import { educationByRecency } from "./education.ts";
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
  "理由优先写画像里具体的技能、实习或项目与 JD 要求的对应关系；专业只在 JD 明确要求时才提，不要把「专业符合」当作主要优势。",
  "用简体中文，语气务实，直接指出差距，每条尽量简短。",
].join("\n");

export const DEFAULT_RERANK_TOP_N = 10;
/** 网关内同一模型只重试一次就切备用模型，更长的等待交给 generateReport 的整体重发。 */
const GATEWAY_RETRIES = 1;
/** 报告 JSON 约 150 个 token；留出余量防止模型跑飞，推理模型即使忽略关闭思考也不至于长时间输出。 */
export const REPORT_MAX_TOKENS = 1536;

const clip = (text: string | undefined, max: number) =>
  text && text.length > max ? `${text.slice(0, max)}…` : text;

const highlightLines = (highlights: { title?: string | undefined; detail: string }[] | undefined) =>
  (highlights ?? []).map((h) => (h.title ? `${h.title}：${h.detail}` : h.detail));

function compactProfile(profile: Profile) {
  return {
    education: educationByRecency(profile)
      .slice(0, 2)
      .map((e) => ({ school: e.school, degree: e.degree, major: e.major })),
    skills: profile.skills.slice(0, 20).map((s) => s.name),
    experiences: profile.experiences.slice(0, 4).map((e) => ({
      company: e.company,
      title: e.title,
      bullets: [...e.bullets, ...highlightLines(e.highlights)].slice(0, 3).map((b) => clip(b, 80)),
    })),
    projects: profile.projects.slice(0, 4).map((p) => ({
      name: p.name,
      role: p.role,
      techStack: p.techStack.slice(0, 8),
      action: clip(p.action || highlightLines(p.highlights).join("；") || undefined, 100),
    })),
    intention: { roles: profile.intention.roles, cities: profile.intention.cities },
  };
}

const JD_PROMPT_CHARS = 1200;

export function buildRerankPrompt(profile: Profile, scored: ScoredJob): string {
  const { job } = scored;
  const dims = DIMENSIONS.filter((k) => scored.dims[k].applicable).map((k) => ({
    dimension: DIMENSION_LABELS[k],
    score: Math.round(scored.dims[k].score * 100),
    evidence: scored.dims[k].evidence.slice(0, 2),
  }));
  const jd = job.jdText.replace(/\n{2,}/g, "\n").slice(0, JD_PROMPT_CHARS);
  return [
    `【候选人画像】\n${JSON.stringify(compactProfile(profile))}`,
    `【岗位】${job.company} · ${job.title}（${job.cities.slice(0, 5).join("/")}）\n${jd}`,
    `【规则打分】总分 ${scored.score}\n${JSON.stringify(dims)}`,
    "请输出匹配报告 JSON：summary、strengths、gaps。",
  ].join("\n\n");
}

export interface RerankOptions {
  topN?: number;
  concurrency?: number;
  /** 单次尝试的总时限（含网关内部重试与流式读取）。 */
  attemptTimeoutMs?: number;
  /** 每个岗位最多尝试几次，卡住的请求在时限内放弃后重发。 */
  attempts?: number;
  retryDelayMs?: number;
  maxTokens?: number;
  /** 批量预生成时为 true，给正在进行的对话让路。 */
  background?: boolean;
  /** 每个报告生成后立刻回调，不必等整批结束。 */
  onReport?: (report: JobReport) => void | Promise<void>;
  onError?: (error: unknown, jobId: string) => void | Promise<void>;
}

export interface JobReport {
  jobId: string;
  report: MatchReportOutput;
  model: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function generateReport(
  llm: StructuredLlm,
  profile: Profile,
  scored: ScoredJob,
  opts: RerankOptions = {},
): Promise<JobReport> {
  const schema = z.toJSONSchema(MatchReportSchema) as Record<string, unknown>;
  const attempts = Math.max(1, opts.attempts ?? 2);
  const timeoutMs = opts.attemptTimeoutMs ?? 35_000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const res = await llm.completeStructured({
        purpose: "match_report",
        system: SYSTEM,
        prompt: buildRerankPrompt(profile, scored),
        schema,
        validate: (v) => MatchReportSchema.parse(v),
        signal,
        maxTokens: opts.maxTokens ?? REPORT_MAX_TOKENS,
        maxRetries: GATEWAY_RETRIES,
        temperature: 0.2,
        ...(opts.background && { background: true }),
      });
      return { jobId: scored.job.id, report: res.value, model: res.model };
    } catch (error) {
      lastError = signal.aborted ? new Error(`匹配报告生成超时（${timeoutMs}ms）`, { cause: error }) : error;
      if (error instanceof LlmUnrecoverableError || attempt === attempts) break;
      await sleep(opts.retryDelayMs ?? 300);
    }
  }
  throw lastError;
}

/** 只给规则分最高的 N 个岗位生成报告；单个失败只丢掉那一条，不影响其余结果。 */
export async function generateReports(
  llm: StructuredLlm,
  profile: Profile,
  ranked: ScoredJob[],
  opts: RerankOptions = {},
): Promise<JobReport[]> {
  const targets = ranked.slice(0, opts.topN ?? DEFAULT_RERANK_TOP_N);
  const results: JobReport[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < targets.length) {
      const scored = targets[cursor++];
      if (!scored) return;
      try {
        const report = await generateReport(llm, profile, scored, opts);
        results.push(report);
        await opts.onReport?.(report);
      } catch (error) {
        await opts.onError?.(error, scored.job.id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, targets.length) }, worker));
  return results;
}
