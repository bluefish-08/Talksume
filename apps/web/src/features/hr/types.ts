import type { ApplicationStatus, ResumeContent } from "@talksume/core";
import type { Application, ApplicationEvent } from "../applications/types.ts";

export interface HrJob {
  id: string;
  title: string;
  company: string;
  cities: string[];
  jobType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  degree: string | null;
  jdText: string;
  tags: string[];
  url: string | null;
  postedAt: string | null;
  applicationCount: number;
  byStatus: Partial<Record<ApplicationStatus, number>>;
}

export interface HrApplication {
  application: Application;
  job: { id: string; title: string; company: string };
  candidate: { id: string; displayName: string; email: string };
  resume: { id: string; template: string; content: ResumeContent; createdAt: string } | null;
}

export interface HrApplicationDetail extends HrApplication {
  timeline: ApplicationEvent[];
}

export interface JobInput {
  title: string;
  company: string;
  cities: string[];
  jobType?: "internship" | "campus" | "experienced";
  salaryMin?: number;
  salaryMax?: number;
  degree?: "any" | "associate" | "bachelor" | "master" | "phd";
  jdText: string;
  tags: string[];
  url?: string;
}

export interface StatusInput {
  to: ApplicationStatus;
  outcome?: "offer" | "rejected";
  note?: string;
  interviewAt?: string;
}
