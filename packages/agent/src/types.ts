import { type Fact, type JobType, Profile, type ProfileSection } from "@talksume/core";
import type { Completeness, Slot } from "./completeness.ts";
import type { Conflict, Draft, ProfileChange } from "./facts.ts";
import type { SkipEntry, SummaryNote } from "./memory.ts";

/** 对话里展示的岗位卡片。 */
export interface JobCard {
  id: string;
  title: string;
  company: string;
  cities: string[];
  jobType?: JobType;
  /** 0–100。 */
  score?: number;
  reason?: string;
}

export interface JobInsight {
  job: JobCard;
  summary?: string;
  strengths: string[];
  gaps: string[];
  /** 各维度得分（0–100）与依据。 */
  dims: { label: string; score: number; evidence: string[] }[];
  /** 没通过硬性筛选时的原因，如城市、学历不符。 */
  blocked?: string;
}

/** 服务端注入的岗位能力；profile 是本轮对话里最新的画像，可能尚未落库。 */
export interface JobTools {
  recommend(
    profile: Profile,
    query: {
      city?: string | undefined;
      jobType?: JobType | undefined;
      keyword?: string | undefined;
      limit: number;
    },
  ): Promise<{ jobs: JobCard[]; total: number; hint?: string }>;
  search(
    profile: Profile,
    query: {
      query: string;
      company?: string | undefined;
      city?: string | undefined;
      jobType?: JobType | undefined;
      limit: number;
    },
  ): Promise<{ jobs: JobCard[]; total: number }>;
  explain(profile: Profile, jobId: string): Promise<JobInsight | null>;
}

/** 对话里展示的定制简历卡片，点开后由用户逐条确认才会采用。 */
export interface TailorCard {
  jobId: string;
  company: string;
  title: string;
  /** 可采用的调整数，不含被拦下的。 */
  changes: number;
  rejected: number;
}

export interface TailorOutcome {
  card: TailorCard;
  /** 给模型看的可采用调整，一行一处。 */
  lines: string[];
}

/** 服务端注入的按岗位定制简历；找不到岗位返回 null。 */
export interface ResumeTailor {
  tailor(profile: Profile, facts: readonly Fact[], jobId: string): Promise<TailorOutcome | null>;
}

/** 落库的工具调用，下一轮重放进模型上下文，便于追问「第二个怎么样」。 */
export interface ToolRecord {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

/** 随助手消息落库的附加信息：本轮写入的变更、快捷回复、岗位卡片与岗位工具调用。 */
export type TurnMeta = {
  changes?: ProfileChange[];
  /** 这条回复追问的目标字段 key。 */
  slot?: string;
  quickReplies?: string[];
  jobs?: JobCard[];
  tailor?: TailorCard;
  tools?: ToolRecord[];
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
  skipped: SkipEntry[];
  /** 之前会话的摘要（L3），只读，由近到远。 */
  summaries?: SummaryNote[];
  /** 等待用户确认的矛盾。 */
  conflicts: Conflict[];
  drafts: Draft[];
}

export function createIntakeState(init: Partial<IntakeState> = {}): IntakeState {
  return {
    profile: Profile.parse({}),
    facts: [],
    history: [],
    completedSections: [],
    askCounts: {},
    skipped: [],
    conflicts: [],
    drafts: [],
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
      /** 问题已写在助手正文里，前端不必再单独显示。 */
      inText?: boolean;
    }
  | { type: "jobs"; source: "recommend" | "search" | "explain"; jobs: JobCard[] }
  | { type: "tailor"; tailor: TailorCard }
  | { type: "completeness"; completeness: Completeness; nextSlot: Slot | null }
  | { type: "error"; code: string; message: string; recoverable: boolean };
