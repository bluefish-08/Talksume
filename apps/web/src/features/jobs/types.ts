export type JobType = "internship" | "campus" | "experienced";
export type Degree = "any" | "associate" | "bachelor" | "master" | "phd";
export type FeedbackSignal = "like" | "dislike" | "irrelevant";

export interface JobSummary {
  id: string;
  source: string;
  company: string;
  title: string;
  cities: string[];
  jobType?: JobType;
  salaryMin?: number;
  salaryMax?: number;
  degree?: Degree;
  tags: string[];
  url?: string;
  postedAt?: string;
  snippet: string;
}

export interface JobDetail extends JobSummary {
  jdText: string;
  status: string;
}

export interface JobList {
  items: JobSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export const DIM_KEYS = ["skills", "role", "experience", "major", "city"] as const;
export type DimKey = (typeof DIM_KEYS)[number];

export interface Dim {
  score: number;
  weight: number;
  evidence: string[];
}

export interface MatchReport {
  summary?: string;
  strengths?: string[];
  gaps?: string[];
}

export interface MatchItem {
  jobId: string;
  score: number;
  dims: Partial<Record<DimKey, Dim>>;
  report: MatchReport;
  feedback: FeedbackSignal | null;
  createdAt: string;
  job: JobSummary;
}

export interface MatchList {
  items: MatchItem[];
  total: number;
}

export type ExcludedReason = "jobType" | "city" | "degree" | "closed";

export interface RefreshResult {
  count: number;
  candidates: number;
  excluded: Record<ExcludedReason, number>;
  hint?: string;
  rerank: "skipped" | "pending" | "done";
}

export interface ImportResult {
  job: JobSummary;
  match: MatchItem | null;
  excluded?: Exclude<ExcludedReason, "closed">;
}

export type ApplicationStatus = "pending" | "applied" | "viewed" | "interviewing" | "closed";

export interface ApplicationRef {
  id: string;
  status: ApplicationStatus;
  channel: string;
  job: { id: string };
}

export interface ApplicationBoard {
  columns: Record<string, ApplicationRef[]>;
  total: number;
}

export interface CreatedApplication {
  application: { id: string; status: ApplicationStatus; channel: string };
  job: { id: string; company: string; title: string; url?: string | null };
  nextAction: "manual_apply" | null;
  submitError?: string;
}
