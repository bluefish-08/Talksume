import type { ApplicationOutcome, ApplicationStatus } from "@talksume/core";

export type Channel = "hr_workspace" | "assisted" | "platform_api";

export interface ApplicationEvent {
  id: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  outcome: ApplicationOutcome | null;
  source: "platform" | "hr" | "user" | "system";
  note: string | null;
  interviewAt: string | null;
  createdAt: string;
}

export interface Application {
  id: string;
  status: ApplicationStatus;
  outcome: ApplicationOutcome | null;
  channel: Channel;
  pitch: string | null;
  resumeVersionId: string | null;
  /** 投递用的是针对该岗位采用的定制版简历。 */
  resumeTailored?: boolean;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobSummary {
  id: string;
  source: string;
  company: string;
  title: string;
  cities: string[];
  jobType: string | null;
  url: string | null;
  status: string;
}

export interface BoardItem extends Application {
  job: JobSummary;
  lastEvent: ApplicationEvent | null;
}

export interface Board {
  columns: Record<ApplicationStatus, BoardItem[]>;
  total: number;
}

export interface ApplicationDetail {
  application: Application;
  job: JobSummary;
  timeline: ApplicationEvent[];
}
