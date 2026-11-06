import type { ResumeStyle } from "@talksume/core";
import type { Completeness, Profile, ProfileSection, ResumeContent } from "../../api/types.ts";

/** 与 packages/agent 的 ProfileChange / Conflict 保持一致（web 不依赖 agent 包）。 */
export interface ProfileChange {
  section: ProfileSection;
  itemId?: string;
  field: string;
  value: unknown;
  previous?: unknown;
}

export interface Conflict {
  factId: string;
  section: ProfileSection;
  itemId?: string;
  field: string;
  label: string;
  previous: unknown;
  proposed: unknown;
  quote: string;
}

/** 与 packages/agent 的 JobCard 保持一致：助手在对话里展示的岗位。 */
export interface JobCard {
  id: string;
  title: string;
  company: string;
  cities: string[];
  jobType?: "internship" | "campus" | "experienced";
  score?: number;
  reason?: string;
  matchKeywords?: { have: string[]; missing: string[] };
}

/** 与 packages/agent 的 TailorCard 保持一致：助手生成的定制简历草稿。 */
export interface TailorCard {
  jobId: string;
  company: string;
  title: string;
  changes: number;
  rejected: number;
}

/** 与 packages/agent 的 DesignOption 保持一致：助手一次给出的几版设计之一。 */
export interface DesignOption {
  id: string;
  name: string;
  summary: string;
  style: ResumeStyle;
  thumbnail: string;
  ats?: { ok: boolean; issues: string[] };
}

/** 导入简历时落库的那条用户消息，正文是抽取出的简历原文。 */
export interface ResumeImportNote {
  fileName?: string;
  facts: number;
}

export interface MessageImage {
  id: string;
  mimeType: string;
}

/** 复刻参考图时服务端推来的进度：round 是第几轮，stage 是这一轮在改样式还是对比预览。 */
export interface StyleProgress {
  stage: "styling" | "previewing" | "designing";
  round: number;
  max: number;
}

export interface ConversationDetail {
  id: string;
  title: string | null;
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    /** 该条助手消息写入简历的变更，刷新后据此重建「已写入」行。 */
    changes: ProfileChange[];
    quickReplies: string[];
    jobs?: JobCard[];
    about?: JobCard;
    tailor?: TailorCard;
    designs?: DesignOption[];
    resumeImport?: ResumeImportNote;
    images?: MessageImage[];
    createdAt: string;
  }[];
  profile: Profile;
  completeness: Completeness;
  resume: ResumeContent;
  conflicts: Conflict[];
}

export interface ChatMessage {
  key: string;
  role: "user" | "assistant";
  /** 模型流式输出的正文。 */
  text: string;
  /** 追问问题；服务端落库时与正文用换行拼接。 */
  asks: string[];
  changes: ProfileChange[];
  /** 助手追问附带的快捷回复，只在最后一条消息上展示。 */
  quickReplies: string[];
  jobs: JobCard[];
  /** 这条回复在讲的具体岗位，顶部显示一行标签；有它时不出岗位卡片。 */
  about?: JobCard;
  tailor?: TailorCard;
  designs?: DesignOption[];
  resumeImport?: ResumeImportNote;
  images?: MessageImage[];
  /** 流式回复中的复刻进度；回复结束后清掉。 */
  progress?: StyleProgress;
  /** 已落库的消息 ID；用户消息用它换算“第几轮”。 */
  serverId?: string;
  state: "done" | "streaming" | "failed";
  error?: string;
}

export const messageText = (m: ChatMessage) => [m.text.trim(), ...m.asks].filter(Boolean).join("\n");
