import type { Fact, Profile } from "@talksume/core";
import type { IntakeState } from "../../src/index.ts";
import type { TurnOutcome } from "../lib/turn.ts";

export interface Snapshot {
  profile: Profile;
  facts: Fact[];
  skipped: string[];
  conflicts: IntakeState["conflicts"];
  drafts: number;
  /** 暂存条目的分区和名字。 */
  draftItems: { section: string; name: string }[];
  completed: string[];
}

export function snapshot(state: IntakeState): Snapshot {
  return structuredClone({
    profile: state.profile,
    facts: state.facts,
    skipped: state.skipped.map((s) => s.key),
    conflicts: state.conflicts,
    drafts: state.drafts.length,
    draftItems: state.drafts.map((d) => ({
      section: d.section,
      name: String(d.item.name ?? d.item.company ?? d.item.school ?? ""),
    })),
    completed: [...state.completedSections],
  });
}

export interface Observation {
  before: Snapshot;
  after: Snapshot;
  outcome: TurnOutcome;
  /** 探针发出前规划器的下一个目标。 */
  nextBefore: { key: string; required: boolean } | null;
  nextAfter: { key: string; required: boolean } | null;
}

export interface Check {
  id: string;
  label: string;
  /** false 的只统计、不计入探针通过与否。 */
  gate: boolean;
  /** write：本轮状态变化（写入正确率）；reply：回复本身（问句数、收尾）。两者分开统计。 */
  kind: "write" | "reply";
  test(o: Observation): boolean;
}

type Item = { name?: string; [k: string]: unknown };
const list = (p: Profile, section: "projects" | "experiences" | "education" | "skills" | "awards") =>
  p[section] as unknown as Item[];
const text = (v: unknown) => JSON.stringify(v ?? "").toLowerCase();

export const newConfirmed = (o: Observation) =>
  o.after.facts.filter((f) => f.status === "confirmed" && !o.before.facts.some((b) => b.id === f.id));

export const newSkips = (o: Observation) => o.after.skipped.filter((k) => !o.before.skipped.includes(k));

const check = (
  id: string,
  label: string,
  test: Check["test"],
  gate = true,
  kind: Check["kind"] = "write",
): Check => ({
  id,
  label,
  gate,
  kind,
  test,
});

export const C = {
  items: (
    section: "projects" | "experiences" | "education" | "skills" | "awards",
    delta: number,
    gate = true,
  ) =>
    check(
      `items:${section}${delta >= 0 ? "+" : ""}${delta}`,
      `${section} 条目数变化 ${delta}`,
      (o) => list(o.after.profile, section).length - list(o.before.profile, section).length === delta,
      gate,
    ),
  /** 画像加暂存里的条目数：暂存转正不算新建。 */
  entities: (section: "projects" | "experiences", delta: number, gate = true) =>
    check(
      `entities:${section}${delta >= 0 ? "+" : ""}${delta}`,
      `${section} 条目数（含暂存）变化 ${delta}`,
      (o) => entityNames(o.after, section).length - entityNames(o.before, section).length === delta,
      gate,
    ),
  noWrite: (gate = true) =>
    check(
      "noWrite",
      "不写入（无新事实、画像不变、无新矛盾）",
      (o) =>
        newConfirmed(o).length === 0 &&
        text(o.after.profile) === text(o.before.profile) &&
        o.after.conflicts.length <= o.before.conflicts.length &&
        o.after.drafts === o.before.drafts,
      gate,
    ),
  noSkip: (gate = true) => check("noSkip", "不新增跳过", (o) => newSkips(o).length === 0, gate),
  skipped: (key: RegExp, gate = true) =>
    check(`skip:${key.source}`, `跳过了 ${key.source}`, (o) => newSkips(o).some((k) => key.test(k)), gate),
  maxQuestions: (n: number, gate = true) =>
    check(`questions<=${n}`, `问句数 ≤ ${n}`, (o) => o.outcome.questions <= n, gate, "reply"),
  questions: (n: number, gate = true) =>
    check(`questions=${n}`, `问句数 = ${n}`, (o) => o.outcome.questions === n, gate, "reply"),
  wraps: (gate = true) => check("wraps", "收尾", (o) => o.outcome.wraps, gate, "reply"),
  noWrapThenAsk: (gate = true) =>
    check("noWrapThenAsk", "收尾后不再提问", (o) => !o.outcome.wrapThenAsk, gate, "reply"),
  noLastItem: (gate = true) =>
    check(
      "noLastItem",
      "不出现「不过还差一项」",
      (o) => !o.outcome.reply.includes("不过还差一项"),
      gate,
      "reply",
    ),
  calledJobs: (gate = true) =>
    check(
      "calledJobs",
      "调用了岗位工具",
      (o) => o.outcome.toolCalls.some((t) => /recommend_jobs|search_jobs/.test(t)),
      gate,
    ),
  noConflictLeft: (gate = true) =>
    check("noConflictLeft", "待确认矛盾已消解", (o) => o.after.conflicts.length === 0, gate),
  profile: (id: string, label: string, test: (p: Profile, before: Profile) => boolean, gate = true) =>
    check(id, label, (o) => test(o.after.profile, o.before.profile), gate),
  custom: check,
};

export const has = (values: readonly { name?: string }[], re: RegExp) =>
  values.some((v) => re.test(v.name ?? ""));
export const projectWith = (p: Profile, re: RegExp) => p.projects.find((x) => re.test(JSON.stringify(x)));

export const entityNames = (s: Snapshot, section: "projects" | "experiences") => [
  ...list(s.profile, section).map((x) => String(x.name ?? x.company ?? "")),
  ...(s.draftItems ?? []).filter((d) => d.section === section).map((d) => d.name),
];
