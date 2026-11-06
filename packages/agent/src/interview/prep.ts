import {
  type AnswerPoint,
  type BulletRef,
  bulletRisks,
  type InterviewKind,
  type InterviewQuestion,
  type ResumeContent,
  resumeBullets,
  ungroundedTokens,
} from "@talksume/core";
import { z } from "zod";
import { buildUserCorpus, normalizeQuote, quoteInCorpus } from "../tools.ts";

export interface InterviewLlm {
  completeStructured<T>(request: {
    purpose: string;
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
    validate: (value: unknown) => T;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<{ value: T; model: string }>;
}

export interface InterviewJob {
  company: string;
  title: string;
  jdText: string;
  tags: string[];
}

export interface InterviewFact {
  id: string;
  quote: string;
}

export interface PrepInput {
  job: InterviewJob;
  resume: ResumeContent;
  facts: readonly InterviewFact[];
  intention?: string;
  signal?: AbortSignal;
}

export const MAX_RESUME_QUESTIONS = 12;
const JD_LIMIT = 2500;
const BATCH = 6;

const POINT_RULES = `答题要点（answerPoints）的硬规则：
- 每个要点都必须来自「用户原话」里说过的事实。quote 逐字摘抄原话片段（不要改写、不要拼接），text 是整理后的简短陈述，不能出现原话里没有的数字、技术名、公司或产品名、职责和程度词。
- 原话里没有的内容一律不写要点。宁可 answerPoints 为空，也不替用户编答案。
- think：原话不足以回答时，写 1 到 3 条让用户自己想清楚的问题（例如「你具体写了哪几个接口」），只提问，不给答案。`;

const RESUME_SYSTEM = `你是面试教练，帮大学生准备面试。面试官手里是求职者递出去的那份简历，会逐条追问。
对下面每一条简历要点各出一道追问题：深挖细节、本人贡献、取舍、结果怎么来的，尤其盯住「主导」「负责」「提升 40%」这类说法。
- question：一个具体的口语化问题，一次只问一件事。
- focus：一句话，面试官想验证什么。
${POINT_RULES}
系统已经对「简历措辞强于原话」做了标注，不需要你重复；可以围绕这些风险出题。`;

const OTHER_SYSTEM = `你是面试教练，帮大学生准备面试。按岗位 JD 和求职者说过的话出下面三类题：
- technical：按 JD 必备技能出技术基础题。jd 必须逐字摘抄 JD 原文里对应要求的片段（不超过 40 字）。focus 写面试官会考察的知识点；answerPoints 只写求职者自己用这项技术做过什么，没有就留空并写 think。
- behavior：STAR 行为题（团队协作、克服困难、处理失败或冲突等）。ref 填最适合讲这个故事的简历要点 id，没有合适的就留空。
- motivation：岗位动机题（为什么选这个岗位或公司、职业规划）。jd 摘抄相关的 JD 片段。
- question 是一个口语化问题，一次只问一件事。
${POINT_RULES}`;

const Point = z.object({ text: z.string().trim().min(1).max(160), quote: z.string().trim().min(1).max(200) });
const Think = z.array(z.string().trim().min(1).max(80)).max(3).default([]);

const ResumeOutput = z.object({
  questions: z.array(
    z.object({
      ref: z.string(),
      question: z.string().trim().min(4).max(120),
      focus: z.string().trim().min(1).max(80),
      answerPoints: z.array(Point).max(5).default([]),
      think: Think,
    }),
  ),
});

const OtherOutput = z.object({
  questions: z.array(
    z.object({
      kind: z.enum(["technical", "behavior", "motivation"]),
      question: z.string().trim().min(4).max(120),
      focus: z.string().trim().min(1).max(80),
      jd: z.string().trim().max(80).nullish(),
      ref: z.string().nullish(),
      answerPoints: z.array(Point).max(5).default([]),
      think: Think,
    }),
  ),
});

type Draft = {
  kind: InterviewKind;
  question: string;
  focus: string;
  jd?: string | undefined;
  bullet?: BulletRef | undefined;
  points: z.infer<typeof Point>[];
  think: string[];
};

interface BulletInfo {
  ref: BulletRef;
  quotes: string[];
}

/** 只留第一个问句，保证面试官一次只问一题。 */
export const oneQuestion = (text: string) => {
  const m = text.match(/^[^？?]*[？?]/);
  return (m ? m[0] : text).trim();
};

const quoteLine = (quotes: readonly string[]) =>
  quotes.length === 0 ? "无" : quotes.map((q) => `「${q.slice(0, 160)}」`).join("");

function bulletInfos(resume: ResumeContent, facts: readonly InterviewFact[]): BulletInfo[] {
  const byId = new Map(facts.map((f) => [f.id, f.quote.trim()]));
  return resumeBullets(resume).map((ref) => ({
    ref,
    quotes: [...new Set(ref.factIds.flatMap((id) => byId.get(id) ?? []).filter(Boolean))],
  }));
}

/** 风险条目、带数字的条目优先，其余按简历顺序；最终仍按简历顺序出题。 */
export function pickBullets(infos: readonly BulletInfo[], limit = MAX_RESUME_QUESTIONS): BulletInfo[] {
  const score = (b: BulletInfo) =>
    (bulletRisks(b.ref.text, b.quotes).some((r) => r.kind === "stronger_than_quote") ? 2 : 0) +
    (/\d/.test(b.ref.text) ? 1 : 0);
  const chosen = new Set(
    infos
      .map((b, i) => ({ b, i, s: score(b) }))
      .sort((x, y) => y.s - x.s || x.i - y.i)
      .slice(0, limit)
      .map((x) => x.b.ref.id),
  );
  return infos.filter((b) => chosen.has(b.ref.id));
}

function resumePrompt(job: InterviewJob, batch: readonly BulletInfo[]): string {
  const lines = [`## 目标岗位\n${job.company} · ${job.title}`, "", "## 简历要点"];
  for (const { ref, quotes } of batch) {
    const risks = bulletRisks(ref.text, quotes).map((r) => r.note);
    lines.push(
      `[${ref.id}] 条目：${[ref.heading, ref.subheading, ref.techStack.join("/")].filter(Boolean).join(" · ")}`,
      `  要点：${ref.text}`,
      `  用户原话：${quoteLine(quotes)}`,
      ...(risks.length > 0 ? [`  系统标注：${risks.join("")}`] : []),
    );
  }
  lines.push(
    "",
    "按 JSON 返回 questions：[{ref, question, focus, answerPoints:[{text, quote}], think}]，每个 ref 一道题。",
  );
  return lines.join("\n");
}

function otherPrompt(input: PrepInput, infos: readonly BulletInfo[]): string {
  const { job } = input;
  const lines = [
    `## 目标岗位\n${job.company} · ${job.title}${job.tags.length > 0 ? `（标签：${job.tags.join("、")}）` : ""}`,
    job.jdText.slice(0, JD_LIMIT),
    "",
    "## 简历要点（behavior 的 ref 从这里选）",
    ...infos.map((b) => `[${b.ref.id}] ${b.ref.heading}：${b.ref.text}`),
    "",
    "## 用户原话（答题要点只能来自这里）",
    ...input.facts
      .filter((f) => f.quote.trim())
      .slice(0, 50)
      .map((f) => `「${f.quote.trim().slice(0, 160)}」`),
    ...(input.intention ? [`求职意向：${input.intention}`] : []),
    "",
    "按 JSON 返回 questions：[{kind, question, focus, jd, ref, answerPoints:[{text, quote}], think}]。technical 5 道、behavior 3 道、motivation 2 道。",
  ];
  return lines.join("\n");
}

function validPoints(points: readonly z.infer<typeof Point>[], corpus: string): AnswerPoint[] {
  const seen = new Set<string>();
  return points.flatMap((p) => {
    const key = normalizeQuote(p.text);
    if (seen.has(key) || !quoteInCorpus(corpus, p.quote) || ungroundedTokens(p.quote, p.text).length > 0) {
      return [];
    }
    seen.add(key);
    return [{ text: p.text, quote: p.quote }];
  });
}

const jdQuoted = (jdText: string, jd: string | null | undefined) =>
  jd && jd.trim().length >= 2 && normalizeQuote(jdText).includes(normalizeQuote(jd)) ? jd.trim() : undefined;

function toQuestion(
  draft: Draft,
  id: string,
  corpus: string,
  quotesOf: ReadonlyMap<string, string[]>,
): InterviewQuestion {
  const answerPoints = validPoints(draft.points, corpus);
  const quotes = draft.bullet ? (quotesOf.get(draft.bullet.id) ?? []) : [];
  const prompts = draft.think.length > 0 ? draft.think.join("；") : draft.focus;
  return {
    id,
    kind: draft.kind,
    question: oneQuestion(draft.question),
    focus: draft.focus,
    source: {
      ...(draft.bullet && { bullet: { heading: draft.bullet.heading, text: draft.bullet.text } }),
      ...(draft.jd && { jd: draft.jd }),
    },
    answerPoints,
    ...(answerPoints.length === 0 && { missing: `你还没讲过这部分，面试前想清楚：${prompts}` }),
    risks: draft.bullet ? bulletRisks(draft.bullet.text, quotes) : [],
  };
}

export interface PrepResult {
  questions: InterviewQuestion[];
  /** 因出处核对不过被丢弃的答题要点数，评测用来观察模型编造的倾向。 */
  dropped: number;
  model: string;
}

/**
 * 简历题逐条对应简历要点，风险由程序按原话比对得出；答题要点逐条核对原话出处，
 * 对不上的整条丢弃，宁可留空也不让模型替用户编答案。
 */
export async function generateInterviewPrep(llm: InterviewLlm, input: PrepInput): Promise<PrepResult> {
  const infos = bulletInfos(input.resume, input.facts);
  const picked = pickBullets(infos);
  const corpus = buildUserCorpus(input.facts.map((f) => f.quote).filter(Boolean));
  const quotesOf = new Map(infos.map((b) => [b.ref.id, b.quotes]));
  const byRef = new Map(infos.map((b) => [b.ref.id, b.ref]));
  const call = <T>(system: string, prompt: string, schema: z.ZodType<T>, maxTokens: number) =>
    llm.completeStructured({
      purpose: "interview_prep",
      system,
      prompt,
      schema: z.toJSONSchema(schema) as Record<string, unknown>,
      validate: (v) => schema.parse(v),
      temperature: 0.3,
      maxTokens,
      ...(input.signal && { signal: input.signal }),
    });

  const batches: BulletInfo[][] = [];
  for (let i = 0; i < picked.length; i += BATCH) batches.push(picked.slice(i, i + BATCH));
  const [resumeRuns, other] = await Promise.all([
    Promise.all(batches.map((b) => call(RESUME_SYSTEM, resumePrompt(input.job, b), ResumeOutput, 2500))),
    call(OTHER_SYSTEM, otherPrompt(input, infos), OtherOutput, 4000),
  ]);

  const drafts: Draft[] = [];
  resumeRuns.forEach((run, i) => {
    const wanted = new Set(batches[i]?.map((b) => b.ref.id));
    const seen = new Set<string>();
    for (const q of run.value.questions) {
      const bullet = byRef.get(q.ref);
      if (!bullet || !wanted.has(q.ref) || seen.has(q.ref)) continue;
      seen.add(q.ref);
      drafts.push({
        kind: "resume",
        question: q.question,
        focus: q.focus,
        bullet,
        points: q.answerPoints,
        think: q.think,
      });
    }
  });
  drafts.sort((a, b) => Number(a.bullet?.id.slice(1)) - Number(b.bullet?.id.slice(1)));

  const counts: Record<string, number> = {};
  const limit = { technical: 5, behavior: 3, motivation: 2 } as const;
  for (const q of other.value.questions) {
    const jd = jdQuoted(input.job.jdText, q.jd);
    if (q.kind === "technical" && !jd) continue;
    const seen = (counts[q.kind] ?? 0) + 1;
    counts[q.kind] = seen;
    if (seen > limit[q.kind]) continue;
    drafts.push({
      kind: q.kind,
      question: q.question,
      focus: q.focus,
      jd,
      bullet: q.ref ? byRef.get(q.ref) : undefined,
      points: q.answerPoints,
      think: q.think,
    });
  }

  const order: InterviewKind[] = ["resume", "technical", "behavior", "motivation"];
  const sorted = order.flatMap((kind) => drafts.filter((d) => d.kind === kind));
  const questions = sorted.map((d, i) => toQuestion(d, `q${i + 1}`, corpus, quotesOf));
  const proposed = sorted.reduce((n, d) => n + d.points.length, 0);
  return {
    questions,
    dropped: proposed - questions.reduce((n, q) => n + q.answerPoints.length, 0),
    model: other.model,
  };
}
