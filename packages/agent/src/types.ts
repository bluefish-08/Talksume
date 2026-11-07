import {
  type Fact,
  type JobType,
  Profile,
  type ProfileSection,
  type ResumeStyle,
  type ResumeThemePatch,
  type TailorChangeKind,
  type TailorLevel,
} from "@talksume/core";
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
  /** 画像里已有和缺失的 JD 关键词，各取前几个。 */
  matchKeywords?: { have: string[]; missing: string[] };
}

export interface MatchKeyword {
  name: string;
  status: "have" | "partial" | "missing";
  source?: string;
}

/** 纯规则的匹配解释：技能、方向词和加权分，不含模型判断。 */
export interface MatchBreakdown {
  score: number;
  components: { label: string; score: number; weight: number; applicable: boolean; note: string }[];
  required: MatchKeyword[];
  bonus: MatchKeyword[];
  concepts: MatchKeyword[];
}

export interface JobInsight {
  job: JobCard;
  breakdown?: MatchBreakdown;
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
export interface TailorCardItem {
  id: string;
  /** 与简历面板上的编号一致；被拦下的改动没有编号。 */
  number?: number;
  title: string;
  /** 一句话说清改了什么。 */
  summary: string;
  selected: boolean;
  blocked: boolean;
  violations?: string[];
  /** 前端据此生成确定性短标签；老数据没有。 */
  kind?: TailorChangeKind;
  /** 一处改动的短名（改写用要点开头，顺序类用排在前面的名字）。 */
  name?: string;
  /** 顺序类改动调整后的名字；摘要/改写不用。 */
  order?: string[];
  /** 技能顺序调整前的顺序，用来找真正提前的技能。 */
  orderBefore?: string[];
  /** 摘要原来是否有内容：有就是改写，没有就是补一段。 */
  hadBefore?: boolean;
}

export interface TailorCard {
  jobId: string;
  company: string;
  title: string;
  level?: TailorLevel;
  /** 可采用的调整数，不含被拦下的。 */
  changes: number;
  rejected: number;
  /** 逐条改动，给卡片和模型映射「摘要那条」用。 */
  items?: TailorCardItem[];
  /** generation 是新生成；update 来自 select/revoke，不单独出卡片。老数据按 generation 处理。 */
  kind?: "generation" | "update";
  /** 卡片生成/更新时的服务端状态；旧数据没有。 */
  status?: "draft" | "adopted" | "revoked";
}

export interface TailorKept {
  changes: number;
  status: "draft" | "adopted" | "revoked";
}

export interface TailorOutcome {
  card: TailorCard;
  /** 给模型看的可采用调整，一行一处。 */
  lines: string[];
  notes?: string[];
  /** 本轮没有新的可用调整，服务端保留了之前那版。 */
  kept?: TailorKept;
}

/** 对话里展示的润色卡片；update 合并进最近一次 generation。 */
export interface PolishCardItem {
  id: string;
  /** 卡片上的编号，被拦下的建议没有编号。 */
  number?: number;
  heading: string;
  before: string;
  after: string;
  state: "pending" | "accepted" | "dismissed";
  blocked: boolean;
  violations?: string[];
}

export interface PolishCard {
  kind?: "generation" | "update";
  status?: "draft" | "adopted" | "partial" | "none";
  items: PolishCardItem[];
}

/** LLM 原样返回的要点，不落库、不进卡片。 */
export interface PolishNoop {
  heading: string;
  before: string;
}

export type PolishState = "pending" | "accepted" | "dismissed";

export interface PolishOutcome {
  card: PolishCard;
  /** 给模型看的一行一处，编号与卡片一致；不传时由卡片生成。 */
  lines?: string[];
  /** 这次实际润色的要点数；不传时按卡片条目数。 */
  polished?: number;
  /** 用户点名但简历里没有的条目标题。 */
  unknownItems?: string[];
  /** 当前可润色的全部条目标题。 */
  headings?: string[];
  /** 本次操作没有改到的 id。 */
  unknownIds?: string[];
  /** 被拦下、不能采用的建议 id。 */
  blockedIds?: string[];
  /** 模型原样返回、没有改动，因此没有落库的要点。 */
  noopItems?: PolishNoop[];
}

export interface PolishOptions {
  /** 条目名称，对应简历上的条目小标题；不传则所有还没有建议的要点。 */
  items?: readonly string[];
  /** 风格要求，只作为提示，不能突破不新增事实的约束。 */
  instruction?: string;
}

export interface PolishDecisionOptions {
  accept?: readonly string[];
  dismiss?: readonly string[];
  revert?: readonly string[];
  all?: "accept" | "dismiss" | "revert";
}

/** 服务端注入的简历润色；profile 是本轮对话里最新的画像。 */
export interface ResumePolisher {
  polish(profile: Profile, options: PolishOptions): Promise<PolishOutcome>;
  decide(profile: Profile, options: PolishDecisionOptions): Promise<PolishOutcome>;
}

/** 服务端注入的按岗位定制简历；找不到岗位返回 null。 */
export interface ResumeTailor {
  tailor(
    profile: Profile,
    facts: readonly Fact[],
    jobId: string,
    level?: TailorLevel,
  ): Promise<TailorOutcome | null>;
  /** 按用户的话改选中项；adopt 为 true 时立即采用。 */
  select(
    jobId: string,
    options: { keep?: readonly string[]; drop?: readonly string[]; adopt?: boolean },
  ): Promise<TailorOutcome | null>;
  /** 改回主简历。 */
  revoke(jobId: string): Promise<TailorOutcome | null>;
}

/** 渲染预览后的版式自检，给模型对照参考图时一并参考。 */
export interface StylePreviewCheck {
  pages: number;
  overflowX: number;
  hiddenText: number;
  overlaps: number;
  lowContrast?: number;
  covered?: number;
}

export interface StylePreview {
  png: Uint8Array;
  check: StylePreviewCheck;
}

export type CssSaveResult =
  | { ok: true; style: ResumeStyle; rules: number; dropped: string[] }
  | { ok: false; errors: string[] };

/** 模型一次给出的一版设计：整套主题（含骨架）加可选的定制 CSS。 */
export interface DesignProposal {
  summary?: string;
  /** 方向库里的方向 id；给了它就不用再给 theme 和 css。 */
  direction?: string;
  accent?: string;
  theme?: unknown;
  css?: string;
}

/** 校验、复核、渲染过缩略图的一版设计，等用户点选。 */
export interface DesignOption {
  id: string;
  /** 来自方向库时的方向 id，用来记住用户见过哪些。 */
  direction?: string;
  name: string;
  summary: string;
  style: ResumeStyle;
  /** data URL（jpeg 缩略图）。 */
  thumbnail: string;
  check: StylePreviewCheck;
  /** 导出 PDF 后网申系统能不能读全；ok 为 false 时 issues 说明原因。 */
  ats: { ok: boolean; issues: string[] };
}

export interface ProposeOutcome {
  options: DesignOption[];
  rejected: { index: number; errors: string[] }[];
}

/** 服务端注入的简历样式存取：校验、归一化和落库都在实现里做。 */
export interface ResumeStyler {
  design(patch: ResumeThemePatch): Promise<{ style: ResumeStyle; notes: string[] }>;
  reset(): Promise<ResumeStyle>;
  /** 保存定制 CSS（null 清除）；不合法时样式保持不变并返回原因。 */
  setCss?(css: string | null): Promise<CssSaveResult>;
  /** 把当前保存的样式套在用户的简历上渲染成一张 PNG。 */
  preview?(signal?: AbortSignal): Promise<StylePreview>;
  /** 一次校验并渲染多版设计的缩略图；不保存，等用户点选。 */
  propose?(designs: DesignProposal[], signal?: AbortSignal): Promise<ProposeOutcome>;
  /** 该用户之前见过的方向 id（新的在前），用来换新鲜的给他。 */
  recentDirections?(): Promise<string[]>;
}

/** 用户在对话里发的图片。data 是 base64，只在发出的这一轮传给模型。 */
export interface ChatImage {
  id: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  data: string;
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
  /** 这条回复因为没记下哪句话而请用户重说；同一句话只请一次。 */
  clarified?: string;
  quickReplies?: string[];
  /** 只是在找岗位时展示的卡片；和 about 互斥。 */
  jobs?: JobCard[];
  /** 这条回复在讲的具体岗位（解读或定制过），只在回复顶部显示一行标签。 */
  about?: JobCard;
  tailor?: TailorCard;
  polish?: PolishCard;
  tools?: ToolRecord[];
  /** 这条回复展示给用户挑选的几版设计。 */
  designs?: DesignOption[];
  /** 这条回复是收尾：之后不再主动提问，用户只回致谢时也不追问。 */
  closed?: boolean;
  /** 这条用户消息是导入的简历原文，正文即抽取出的文字。 */
  resumeImport?: { fileName?: string; facts: number };
  /** 这条用户消息带的图片；只留引用，图片本身不再回放给模型。 */
  images?: { id: string; mimeType: string }[];
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

/** 下一步只由代码决定：问哪一项、首次收尾、已收尾（不再提问）、有待确认的矛盾（先不问也不收尾）。 */
export type Plan = { kind: "ask"; slot: Slot } | { kind: "wrap" } | { kind: "closed" } | { kind: "hold" };

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
  | { type: "jobs"; source: "recommend" | "search"; jobs: JobCard[] }
  | { type: "about_job"; job: JobCard }
  | { type: "tailor"; tailor: TailorCard }
  | { type: "polish"; polish: PolishCard }
  | { type: "resume_style"; style: ResumeStyle }
  | { type: "style_options"; options: DesignOption[] }
  | { type: "style_progress"; stage: "styling" | "previewing" | "designing"; round: number; max: number }
  | { type: "completeness"; completeness: Completeness; nextSlot: Slot | null }
  | { type: "error"; code: string; message: string; recoverable: boolean };
