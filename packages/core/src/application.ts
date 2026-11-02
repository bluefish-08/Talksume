export const APPLICATION_STATUSES = ["pending", "applied", "viewed", "interviewing", "closed"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export type ApplicationOutcome = "offer" | "rejected";

export type StatusSource = "platform" | "hr" | "user" | "system";

const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  pending: ["applied"],
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
  return outcome === undefined ? { from, to, source, at } : { from, to, outcome, source, at };
}
