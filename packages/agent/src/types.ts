import { type Fact, Profile, type ProfileSection } from "@talksume/core";
import type { Completeness, Slot } from "./completeness.ts";
import type { Conflict, ProfileChange } from "./facts.ts";

/** 随助手消息落库的附加信息：本轮写入的变更与快捷回复。 */
export type TurnMeta = {
  changes?: ProfileChange[];
  quickReplies?: string[];
};

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: TurnMeta;
}

/** 一次会话的全部可持久化状态；控制器原地修改，由调用方负责落库。 */
export interface IntakeState {
  profile: Profile;
  facts: Fact[];
  history: ChatTurn[];
  completedSections: ProfileSection[];
  askCounts: Record<string, number>;
  /** 等待用户确认的矛盾。 */
  conflicts: Conflict[];
}

export function createIntakeState(init: Partial<IntakeState> = {}): IntakeState {
  return {
    profile: Profile.parse({}),
    facts: [],
    history: [],
    completedSections: [],
    askCounts: {},
    conflicts: [],
    ...init,
  };
}

export type AskKind = "followup" | "clarify" | "confirm";

export interface SlotRef {
  key: string;
  section: ProfileSection;
  field: string;
  itemId?: string;
}

export type IntakeEvent =
  | { type: "token"; text: string }
  | { type: "profile_patch"; changes: ProfileChange[]; facts: Fact[]; profile: Profile }
  | {
      type: "ask";
      kind: AskKind;
      question: string;
      slot?: SlotRef;
      conflict?: Conflict;
      quickReplies?: string[];
    }
  | { type: "completeness"; completeness: Completeness; nextSlot: Slot | null }
  | { type: "error"; code: string; message: string; recoverable: boolean };
