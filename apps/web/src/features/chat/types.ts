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

export interface ConversationDetail {
  id: string;
  title: string | null;
  messages: { id: string; role: "user" | "assistant"; content: string; createdAt: string }[];
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
  /** 已落库的消息 ID；用户消息用它换算“第几轮”。 */
  serverId?: string;
  state: "done" | "streaming" | "failed";
  error?: string;
}

export const messageText = (m: ChatMessage) => [m.text.trim(), ...m.asks].filter(Boolean).join("\n");
