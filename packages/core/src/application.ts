export const APPLICATION_STATUSES = ["pending", "applied", "viewed", "interviewing", "closed"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export type ApplicationOutcome = "offer" | "rejected" | "withdrawn";

export type StatusSource = "platform" | "hr" | "user" | "system";

const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  pending: ["applied", "closed"],
  applied: ["viewed", "closed"],
  viewed: ["interviewing", "closed"],
  interviewing: ["closed"],
  closed: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface StatusChange {
  from: ApplicationStatus;
  to: ApplicationStatus;
  outcome?: ApplicationOutcome;
  source: StatusSource;
  at: Date;
}

export class InvalidTransitionError extends Error {
  readonly from: ApplicationStatus;
  readonly to: ApplicationStatus;

  constructor(from: ApplicationStatus, to: ApplicationStatus) {
    super(`投递状态不能从 ${from} 变为 ${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function transition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  source: StatusSource,
  outcome?: ApplicationOutcome,
  at: Date = new Date(),
): StatusChange {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
  if ((to === "closed") !== (outcome !== undefined)) {
    throw new Error("只有进入 closed 时需要且必须给出 outcome");
  }
  if (outcome === "withdrawn" && source !== "user") throw new Error("withdrawn 只能由候选人本人触发");
  return outcome === undefined ? { from, to, source, at } : { from, to, outcome, source, at };
}

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: "待投递",
  applied: "已投递",
  viewed: "已查看",
  interviewing: "面试中",
  closed: "已结束",
};

const OUTCOME_LABELS: Record<ApplicationOutcome, string> = {
  offer: "已录用",
  rejected: "未通过",
  withdrawn: "已撤回",
};

export function statusLabel(status: ApplicationStatus, outcome?: ApplicationOutcome | null): string {
  return status === "closed" && outcome ? OUTCOME_LABELS[outcome] : STATUS_LABELS[status];
}

export function statusChangeTitle(
  company: string,
  jobTitle: string,
  status: ApplicationStatus,
  outcome?: ApplicationOutcome | null,
): string {
  return `「${company}·${jobTitle}」状态更新为：${statusLabel(status, outcome)}`;
}
