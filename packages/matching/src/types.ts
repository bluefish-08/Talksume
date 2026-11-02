import type { Job } from "@talksume/core";

export const DIMENSIONS = ["skills", "role", "experience", "major", "city"] as const;
export type DimensionKey = (typeof DIMENSIONS)[number];

export type Weights = Record<DimensionKey, number>;

export const DEFAULT_WEIGHTS: Weights = {
  skills: 0.3,
  role: 0.25,
  experience: 0.2,
  major: 0.15,
  city: 0.1,
};

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  skills: "技能匹配",
  role: "意向岗位契合",
  experience: "项目/经历相关",
  major: "专业相关",
  city: "城市契合",
};

export interface DimensionScore {
  /** 0–1。 */
  score: number;
  /** 该维度没有可比较的信息（如画像没填城市）时为 false，总分计算时会把权重分给其他维度。 */
  applicable: boolean;
  /** 每条证据指向画像字段或 JD 原文。 */
  evidence: string[];
}

export type DimensionScores = Record<DimensionKey, DimensionScore>;

export type Degree = NonNullable<Job["degree"]>;

export type FilterReason = "jobType" | "city" | "degree" | "closed";

export interface FilterResult {
  pass: boolean;
  reason?: FilterReason;
  detail?: string;
}

export interface FeedbackEntry {
  jobId: string;
  company: string;
  title: string;
  signal: "like" | "dislike" | "irrelevant";
}

export interface ScoredJob {
  job: Job;
  /** 0–100，已含反馈调整。 */
  score: number;
  baseScore: number;
  dims: DimensionScores;
  /** 各维度实际生效的权重（不适用的维度为 0，其余按比例放大）。 */
  weights: Weights;
  feedbackMultiplier: number;
  feedbackEvidence: string[];
}

export interface MatchOptions {
  weights?: Partial<Weights>;
  /** 为 false 时城市不符只扣分，不剔除。 */
  strictCity?: boolean;
  /** 过滤后候选超过该数量时先召回再打分。 */
  recallLimit?: number;
  /** 向量召回得到的余弦相似度，key 为 jobId；没有时只用 BM25。 */
  vectorScores?: Map<string, number>;
  feedback?: FeedbackEntry[];
}

export interface MatchOutcome {
  matches: ScoredJob[];
  excluded: Record<FilterReason, number>;
  candidates: number;
  recalled: number;
}
