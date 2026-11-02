import type { Fact, Profile, ProfileSection } from "@talksume/core";
import { computeCompleteness, SECTION_BY_NAME, type Slot } from "./completeness.ts";
import type { ProfileChange } from "./facts.ts";
import type { IntakeState } from "./types.ts";

/** 用户跳过或明确说没有的一项；field 为空表示整个分区。 */
export interface SkipEntry {
  key: string;
  section: ProfileSection;
  itemId?: string;
  field?: string;
  label: string;
  quote: string;
  at: string;
}

/** L2 问答账本：用户级，跨会话共享。 */
export interface Ledger {
  completedSections: ProfileSection[];
  askCounts: Record<string, number>;
  skipped: SkipEntry[];
}

export function emptyLedger(): Ledger {
  return { completedSections: [], askCounts: {}, skipped: [] };
}

export function ledgerOf(state: Pick<IntakeState, keyof Ledger>): Ledger {
  return structuredClone({
    completedSections: state.completedSections,
    askCounts: state.askCounts,
    skipped: state.skipped,
  });
}

/** 合并多份账本（老会话各自存的 completedSections / askCounts）：分区取并集，次数累加。 */
export function mergeLedgers(parts: readonly Partial<Ledger>[]): Ledger {
  const out = emptyLedger();
  for (const part of parts) {
    for (const s of part.completedSections ?? [])
      if (!out.completedSections.includes(s)) out.completedSections.push(s);
    for (const [k, v] of Object.entries(part.askCounts ?? {})) {
      if (typeof v === "number") out.askCounts[k] = (out.askCounts[k] ?? 0) + v;
    }
    for (const e of part.skipped ?? []) if (!out.skipped.some((x) => x.key === e.key)) out.skipped.push(e);
  }
  return out;
}

/** 把本会话相对加载时的增量叠加到库里最新的账本上，避免并行会话互相覆盖。 */
export function rebaseLedger(current: Ledger, before: Ledger, after: Ledger): Ledger {
  const askCounts = { ...current.askCounts };
  for (const [k, v] of Object.entries(after.askCounts)) {
    const delta = v - (before.askCounts[k] ?? 0);
    if (delta !== 0) askCounts[k] = Math.max(0, (askCounts[k] ?? 0) + delta);
  }
  const added = after.completedSections.filter((s) => !before.completedSections.includes(s));
  const removed = before.completedSections.filter((s) => !after.completedSections.includes(s));
  const completedSections = [
    ...current.completedSections.filter((s) => !removed.includes(s)),
    ...added.filter((s) => !current.completedSections.includes(s)),
  ];
  const beforeKeys = new Set(before.skipped.map((e) => e.key));
  const afterKeys = new Set(after.skipped.map((e) => e.key));
  const addedSkips = after.skipped.filter((e) => !beforeKeys.has(e.key));
  const dropped = new Set([...beforeKeys].filter((k) => !afterKeys.has(k)));
  const skipped = [
    ...current.skipped.filter((e) => !dropped.has(e.key) && !addedSkips.some((a) => a.key === e.key)),
    ...addedSkips,
  ];
  return { completedSections, askCounts, skipped };
}

export function skippedKeys(state: Pick<IntakeState, "skipped">): Set<string> {
  return new Set(state.skipped.map((e) => e.key));
}

export function sectionSkipKey(section: ProfileSection): string {
  return `${section}:*`;
}

export function slotLabel(slot: Pick<Slot, "section" | "itemLabel" | "label">): string {
  return [SECTION_BY_NAME[slot.section].label, slot.itemLabel, slot.label].filter(Boolean).join("-");
}

export function skipEntryOf(slot: Slot, quote: string, at = new Date()): SkipEntry {
  return {
    key: slot.key,
    section: slot.section,
    ...(slot.itemId ? { itemId: slot.itemId } : {}),
    field: slot.field,
    label: slotLabel(slot),
    quote,
    at: at.toISOString(),
  };
}

export function sectionSkipEntry(section: ProfileSection, quote: string, at = new Date()): SkipEntry {
  return {
    key: sectionSkipKey(section),
    section,
    label: SECTION_BY_NAME[section].label,
    quote,
    at: at.toISOString(),
  };
}

function lifts(entry: SkipEntry, change: ProfileChange): boolean {
  if (change.section !== entry.section) return false;
  if (!entry.field || entry.field === "_item") return true;
  if (entry.itemId && change.itemId !== entry.itemId) return false;
  return change.field === entry.field || entry.field === `${change.field}_quantified`;
}

/** 用户主动提起已跳过的项并写入后，解除跳过；整区跳过的同时撤销该分区的完成标记。 */
export function liftSkips(state: IntakeState, changes: readonly ProfileChange[]): SkipEntry[] {
  const lifted = state.skipped.filter((e) => changes.some((c) => lifts(e, c)));
  if (lifted.length === 0) return [];
  state.skipped = state.skipped.filter((e) => !lifted.includes(e));
  for (const e of lifted) {
    if (!e.field) state.completedSections = state.completedSections.filter((s) => s !== e.section);
  }
  return lifted;
}

export interface SummaryNote {
  summary: string;
  topic?: string;
  createdAt: Date | string;
}

export const MEMORY_PROMPT_BUDGET = 900;
const QUOTE_LIMIT = 20;

/** 账本与摘要注入 system prompt 的部分；超出预算时从最旧的条目开始丢。 */
export function memoryPromptLines(
  skipped: readonly SkipEntry[],
  summaries: readonly SummaryNote[],
  budget = MEMORY_PROMPT_BUDGET,
): string[] {
  const skipLines = [...skipped]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e) => `- ${e.label}（原话「${e.quote.slice(0, QUOTE_LIMIT)}」）`);
  const summaryLines = summaries.slice(0, 3).map((s) => {
    const day = new Date(s.createdAt).toISOString().slice(0, 10);
    return `- ${day}：${s.summary.slice(0, 150)}`;
  });
  const lines: string[] = [];
  let used = 0;
  // 每行按「换行 + 内容」计长；已跳过项最多占六成，给摘要留位置
  const take = (header: string, items: string[], limit: number) => {
    let size = header.length + 2;
    const kept: string[] = [];
    for (const item of items) {
      if (used + size + item.length + 1 > limit) break;
      kept.push(item);
      size += item.length + 1;
    }
    if (kept.length > 0) {
      used += size;
      lines.push("", header, ...kept);
    }
  };
  take(
    "## 已跳过 / 已确认没有（不要再问；用户主动提起时照常写入）",
    skipLines,
    summaryLines.length > 0 ? budget * 0.6 : budget,
  );
  take("## 之前几次会话的摘要（由近到远，仅供参考，不要逐条复述）", summaryLines, budget);
  return lines;
}

const TOPIC_KEYS = ["name", "school", "company", "title"] as const;

/** 画像里最近写入的条目，用作接续式开场的话头。 */
export function topicOfFacts(facts: readonly Fact[]): string | undefined {
  for (const fact of [...facts].reverse()) {
    if (fact.status === "superseded") continue;
    const label = SECTION_BY_NAME[fact.section].label;
    const payload = fact.payload as Record<string, unknown>;
    if (fact.section === "intention" && Array.isArray(payload.roles) && payload.roles.length > 0) {
      return `求职意向「${String(payload.roles[0])}」`;
    }
    const named = TOPIC_KEYS.map((k) => payload[k]).find((v) => typeof v === "string" && v.trim());
    if (named && fact.section !== "basics") return `${label}里的「${String(named)}」`;
    if (fact.section !== "basics") return label;
  }
  return undefined;
}

export const NEW_USER_GREETING =
  "你好，我是简聊助手。接下来我们边聊边整理简历，聊到哪里都可以先停，下次接着来。";

/** 画像为空时用首次见面的开场；已有内容时接续上次的话题。 */
export function openingMessage(input: {
  profile: Profile;
  slot: Slot | null;
  topic?: string | undefined;
}): string {
  const hasContent = computeCompleteness(input.profile).score > 0;
  if (!hasContent) return input.slot ? `${NEW_USER_GREETING}${input.slot.question}` : NEW_USER_GREETING;
  const name = input.profile.basics.name?.trim();
  const hello = name ? `欢迎回来，${name}。` : "欢迎回来。";
  const recap = input.topic ? `上次聊到${input.topic}，` : "";
  if (input.slot) return `${hello}${recap}这次接着补充：${input.slot.question}`;
  return `${hello}${recap}这次想补点什么？`;
}
