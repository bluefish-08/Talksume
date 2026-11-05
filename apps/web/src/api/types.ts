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
  /** 0–1，这个分区写进简历的内容有多充实 */
  score: number;
  /** 问完了：内容齐了，或用户跳过、说没有 */
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
  kind?: "field" | "new_item" | "deepen" | "quantify" | "probe";
}

export interface QualityGap {
  key: string;
  /** 名词短语，拼成「还缺 X」 */
  label: string;
  prompt: string;
}

export interface Completeness {
  /** 0–1，简历充实度：只算简历里真有的内容，跳过的不算 */
  score: number;
  /** 0–1，建档进度，只给助手判断还要不要追问 */
  progress?: number;
  sections: SectionCompleteness[];
  missing: MissingField[];
  gaps?: QualityGap[];
  /** 经历太少时「投递前可以补的东西」，不进简历 */
  tips?: string[];
}
