import type { Profile, ResumeContent } from "@talksume/core";

export type { Profile, ResumeContent };

export interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  kind: "status_changed" | "follow_up" | "interview_soon";
  title: string;
  refId: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: NotificationItem[];
  unreadCount: number;
}

export interface ProfileResponse {
  profile: Profile;
  version: number;
  completeness: Completeness;
}

export type ProfileSection =
  | "basics"
  | "education"
  | "experiences"
  | "projects"
  | "skills"
  | "awards"
  | "intention";

export const SECTION_LABELS: Record<ProfileSection, string> = {
  basics: "基本信息",
  education: "教育",
  experiences: "实习",
  projects: "项目",
  skills: "技能",
  awards: "荣誉",
  intention: "求职意向",
};

export interface SectionCompleteness {
  section: ProfileSection;
  weight: number;
  /** 0–1 */
  score: number;
  completed: boolean;
}

export interface MissingField {
  key: string;
  section: ProfileSection;
  itemId?: string;
  itemLabel?: string;
  field: string;
  label: string;
  weight: number;
  required: boolean;
}

export interface Completeness {
  /** 0–1 */
  score: number;
  sections: SectionCompleteness[];
  missing: MissingField[];
}
