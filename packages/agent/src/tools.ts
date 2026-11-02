import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import type { ProfileSection } from "@talksume/core";
import type { z } from "zod";
import {
  computeCompleteness,
  isQuantified,
  isSkipped,
  pickNextSlot,
  SECTION_BY_NAME,
  type Slot,
  toSlot,
} from "./completeness.ts";
import {
  applyFacts,
  type Conflict,
  describeDrafted,
  draftLabel,
  draftMissing,
  resolveConflict,
} from "./facts.ts";
import { liftSkips, type SkipEntry, sectionSkipEntry, skipEntryOf, skippedKeys } from "./memory.ts";
import { describeSlot } from "./prompt.ts";
import {
  AskUserArgs,
  CompleteSectionArgs,
  cleanQuickReplies,
  type FactInput,
  formatZodIssues,
  ResolveConflictArgs,
  SkipFieldArgs,
  TOOL_SPECS,
  type ToolName,
  toolJsonSchema,
  UpsertFactsArgs,
} from "./schemas.ts";
import type { IntakeEvent, IntakeState, SlotRef } from "./types.ts";

export interface RunContext {
  state: IntakeState;
  messageId: string;
  /** 所有用户发言归一化后的拼接，用于核对 quote 确为原话。 */
  userCorpus: string;
  verifyQuote: boolean;
  genId: (prefix: string) => string;
  emit(event: IntakeEvent): void;
  flags: { asked: boolean; changed: boolean; jobs?: boolean };
}

export function normalizeQuote(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

export function buildUserCorpus(texts: readonly string[]): string {
  return texts.map(normalizeQuote).join("|");
}

export const MIN_QUOTE_SEGMENT = 2;

/** quote 可用 … 或 ... 拼接不相邻的原话片段，每段都要命中语料。 */
export function quoteInCorpus(corpus: string, quote: string): boolean {
  const segments = quote
    .split(/…+|\.{3,}/)
    .map(normalizeQuote)
    .filter(Boolean);
  if (segments.length === 0) return false;
  // 单段沿用原规则，允许「男」这类极短回答；分段时短段易在语料中偶然命中
  if (segments.length > 1 && segments.some((seg) => seg.length < MIN_QUOTE_SEGMENT)) return false;
  return segments.every((seg) => corpus.includes(seg));
}

export function text(value: string, isError = false): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: value }], details: {}, ...(isError ? { isError: true } : {}) };
}

function slotRef(slot: Slot): SlotRef {
  return {
    key: slot.key,
    section: slot.section,
    field: slot.field,
    ...(slot.itemId ? { itemId: slot.itemId } : {}),
  };
}

/** 暂存的条目优先补齐，问过两次仍不答就放过，回到正常顺序。 */
function draftSlot(state: IntakeState, skipped: ReadonlySet<string>): Slot | null {
  for (const draft of state.drafts) {
    const spec = SECTION_BY_NAME[draft.section];
    const id = String(draft.item.id);
    for (const field of draftMissing(draft)) {
      const key = `${draft.section}:${id}:${field}`;
      if ((state.askCounts[key] ?? 0) >= 2 || skipped.has(key)) continue;
      const f = spec.fields.find((x) => x.field === field);
      return {
        key,
        section: draft.section,
        itemId: id,
        itemLabel: draftLabel(draft),
        field,
        label: f?.label ?? field,
        weight: f?.weight ?? 1,
        required: true,
        kind: "field",
        question: f?.question ?? `请补充${f?.label ?? field}`,
        strategy: f?.strategy ?? "",
      };
    }
  }
  return null;
}

export function nextSlotOf(state: IntakeState): Slot | null {
  const skipped = skippedKeys(state);
  const draft = draftSlot(state, skipped);
  if (draft) return draft;
  return pickNextSlot(state.profile, {
    completedSections: state.completedSections,
    askCounts: state.askCounts,
    skipped,
  });
}

const NO_NUMBERS =
  /没(?:有)?(?:什么|啥)?(?:具体|准确|明确)?的?(?:数字|数据|量化|统计)|没(?:有)?(?:统计|量化)过?|记不(?:清|得|太清)|不记得|忘了|说不上来/;

/** 上一轮问的是量化结果、用户答没有数字或记不清时直接记为跳过，不指望模型记得调用 skip_field。 */
export function skipUnquantified(state: IntakeState, text: string): SkipEntry | null {
  const key = state.history.findLast((t) => t.role === "assistant")?.meta?.slot;
  if (!key || isQuantified(text)) return null;
  const hit = text.match(NO_NUMBERS);
  if (!hit) return null;
  const { missing } = computeCompleteness(state.profile, { completedSections: state.completedSections });
  const slot = missing.find((m) => m.key === key && m.kind === "quantify");
  if (!slot) return null;
  const entry = skipEntryOf(toSlot(slot), hit[0]);
  state.skipped = [...state.skipped.filter((e) => e.key !== entry.key), entry];
  return entry;
}

/** 可被 skip_field 跳过的字段：暂存条目的缺项和画像里仍缺的项。 */
function skippableSlot(state: IntakeState, key: string): Slot | null {
  const draft = draftSlot(state, new Set());
  if (draft?.key === key) return draft;
  const { missing } = computeCompleteness(state.profile, { completedSections: state.completedSections });
  const hit = missing.find((m) => m.key === key);
  return hit ? toSlot(hit) : null;
}

export function noteAsked(state: IntakeState, slot: Slot | null): void {
  if (slot) state.askCounts[slot.key] = (state.askCounts[slot.key] ?? 0) + 1;
}

export function confirmQuestion(conflict: Conflict): string {
  const label = conflict.label;
  return `你之前说${label}是「${String(conflict.previous)}」，刚才说的是「${String(conflict.proposed)}」，以哪个为准？`;
}

export function completenessEvent(state: IntakeState): IntakeEvent {
  return {
    type: "completeness",
    completeness: computeCompleteness(state.profile, { completedSections: state.completedSections }),
    nextSlot: nextSlotOf(state),
  };
}

/** 按用户的选择消解一处矛盾；还有剩余矛盾时接着发起下一条确认，事件以 completeness 收尾。 */
export function settleConflict(state: IntakeState, factId: string, accept: boolean): IntakeEvent[] {
  const conflict = state.conflicts.find((c) => c.factId === factId);
  if (!conflict) return [];
  const resolved = resolveConflict(state.profile, state.facts, conflict, accept);
  state.profile = resolved.profile;
  state.facts = resolved.facts;
  state.conflicts = state.conflicts.filter((c) => c.factId !== factId);
  const events: IntakeEvent[] = [];
  if (resolved.changes.length > 0) {
    events.push({
      type: "profile_patch",
      changes: resolved.changes,
      facts: state.facts.filter((f) => f.id === factId),
      profile: state.profile,
    });
  }
  const remaining = state.conflicts[0];
  if (remaining) {
    events.push({ type: "ask", kind: "confirm", question: confirmQuestion(remaining), conflict: remaining });
  }
  events.push(completenessEvent(state));
  return events;
}

function prepare<S extends z.ZodType>(schema: S) {
  return (args: unknown) => {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(`参数校验失败：${formatZodIssues(parsed.error)}。请严格按工具 schema 修正后重新调用。`);
    }
    return parsed.data as never;
  };
}

export function tool(
  name: ToolName,
  label: string,
  schema: z.ZodType,
  execute: (params: never) => AgentToolResult<unknown> | Promise<AgentToolResult<unknown>>,
): AgentTool<TSchema> {
  const spec = TOOL_SPECS.find((s) => s.name === name);
  if (!spec) throw new Error(`unknown tool ${name}`);
  return {
    name,
    label,
    description: spec.description,
    parameters: toolJsonSchema(schema) as unknown as TSchema,
    prepareArguments: prepare(schema),
    executionMode: "sequential",
    execute: async (_id, params) => execute(params as never),
  };
}

export function createIntakeTools(ctx: RunContext): AgentTool<TSchema>[] {
  const { state } = ctx;

  const upsertFacts = tool(
    "upsert_facts",
    "写入事实",
    UpsertFactsArgs,
    (args: z.infer<typeof UpsertFactsArgs>) => {
      const rejected: string[] = [];
      const accepted: { input: FactInput; index: number }[] = [];
      args.facts.forEach((input, index) => {
        if (ctx.verifyQuote && !quoteInCorpus(ctx.userCorpus, input.quote)) {
          rejected.push(
            `第 ${index + 1} 条：quote「${input.quote}」不是用户说过的原话，请逐字摘抄；不相邻的片段用 … 分隔，每段至少 ${MIN_QUOTE_SEGMENT} 个字`,
          );
        } else accepted.push({ input, index });
      });

      const result = applyFacts(
        state.profile,
        accepted.map((a) => a.input),
        { messageId: ctx.messageId, genId: ctx.genId, drafts: state.drafts, userText: ctx.userCorpus },
      );
      for (const r of result.rejected) {
        rejected.push(`第 ${(accepted[r.index]?.index ?? r.index) + 1} 条：${r.reason}`);
      }

      state.profile = result.profile;
      state.drafts = result.drafts;
      state.facts.push(...result.facts);
      liftSkips(state, result.changes);
      if (result.drafted.length > 0) ctx.flags.changed = true;
      if (result.changes.length > 0 || result.facts.length > 0) {
        ctx.flags.changed = true;
        ctx.emit({
          type: "profile_patch",
          changes: result.changes,
          facts: result.facts,
          profile: state.profile,
        });
      }
      for (const conflict of result.conflicts) {
        state.conflicts.push(conflict);
        ctx.flags.asked = true;
        ctx.emit({ type: "ask", kind: "confirm", question: confirmQuestion(conflict), conflict });
      }

      const lines: string[] = [];
      const confirmed = result.facts.filter((f) => f.status === "confirmed").length;
      lines.push(`已写入 ${confirmed} 条事实。`);
      if (result.conflicts.length > 0) {
        lines.push(
          `有 ${result.conflicts.length} 处与已记录内容矛盾，已自动向用户发起确认，本轮请不要再追问其他内容，不要在文字里复述矛盾，也不要调用 ask_user。`,
        );
      }
      if (result.drafted.length > 0) lines.push(result.drafted.map(describeDrafted).join("\n"));
      if (result.dropped.length > 0) {
        const dropped = result.dropped.map(
          (d) => `第 ${(accepted[d.index]?.index ?? d.index) + 1} 条的 ${d.field}：${d.reason}`,
        );
        lines.push(`已忽略这些推测字段（事实其余部分照常写入），用户没说就留空：\n${dropped.join("\n")}`);
      }
      if (rejected.length > 0) lines.push(`被拒绝：\n${rejected.join("\n")}`);
      const next = nextSlotOf(state);
      lines.push(next ? `下一个目标：\n${describeSlot(next)}` : "下一个目标：无，信息已基本完整。");
      return text(lines.join("\n"), confirmed === 0 && result.conflicts.length === 0 && rejected.length > 0);
    },
  );

  const askUser = tool("ask_user", "追问", AskUserArgs, (args: z.infer<typeof AskUserArgs>) => {
    if (ctx.flags.asked) return { ...text("本轮已经向用户提问，不要重复提问。"), terminate: true };
    const slot = nextSlotOf(state);
    ctx.flags.asked = true;
    noteAsked(state, slot);
    const given = cleanQuickReplies(args.quickReplies);
    const quickReplies = given.length > 0 ? given : cleanQuickReplies(slot?.replies);
    ctx.emit({
      type: "ask",
      kind: "followup",
      question: args.question,
      ...(slot ? { slot: slotRef(slot) } : {}),
      ...(quickReplies.length > 0 ? { quickReplies } : {}),
    });
    return { ...text("问题已发送给用户，等待回答。"), terminate: true };
  });

  const completeSection = tool(
    "complete_section",
    "完成分区",
    CompleteSectionArgs,
    (args: z.infer<typeof CompleteSectionArgs>) => {
      const section: ProfileSection = args.section;
      const label = SECTION_BY_NAME[section].label;
      if (args.reason === "user_skipped") {
        if (!args.quote || (ctx.verifyQuote && !quoteInCorpus(ctx.userCorpus, args.quote))) {
          return text("user_skipped 必须附带用户表示没有/不想提供的原话 quote。", true);
        }
      } else {
        const skipped = skippedKeys(state);
        const { missing: all } = computeCompleteness(state.profile);
        // 深挖项问过两次或用户跳过的不再拦着，免得卡死在这个分区
        const missing = all
          .filter(
            (m) =>
              m.section === section &&
              m.required &&
              (m.kind === "field" || m.kind === "deepen") &&
              !isSkipped(m, skipped) &&
              (!m.depth || (state.askCounts[m.key] ?? 0) < 2),
          )
          .map((m) => (m.itemLabel ? `「${m.itemLabel}」的${m.label}` : m.label));
        const empty = all.some((m) => m.section === section && m.kind === "new_item" && m.required);
        if (missing.length > 0 || empty) {
          return text(
            `「${label}」还缺必填信息：${missing.join("、") || "至少一条记录"}。请先追问，或在用户明确不想提供时用 user_skipped。`,
            true,
          );
        }
      }
      if (!state.completedSections.includes(section)) state.completedSections.push(section);
      if (args.reason === "user_skipped" && args.quote) {
        const entry = sectionSkipEntry(section, args.quote);
        state.skipped = [...state.skipped.filter((e) => e.key !== entry.key), entry];
      }
      const next = nextSlotOf(state);
      return text(
        `已完成「${label}」。${next ? `\n下一个目标：\n${describeSlot(next)}` : "\n所有分区均已完成。"}`,
      );
    },
  );

  const skipField = tool("skip_field", "跳过字段", SkipFieldArgs, (args: z.infer<typeof SkipFieldArgs>) => {
    if (ctx.verifyQuote && !quoteInCorpus(ctx.userCorpus, args.quote)) {
      return text(`quote「${args.quote}」不是用户说过的原话，请逐字摘抄用户表示没有/不想说的那句话。`, true);
    }
    const slot = args.key ? skippableSlot(state, args.key) : nextSlotOf(state);
    if (!slot) {
      return text(
        args.key
          ? `找不到 key=${args.key} 的待补字段，请用「当前目标字段」里的 key。`
          : "当前没有待补的字段。",
        true,
      );
    }
    const entry = skipEntryOf(slot, args.quote);
    state.skipped = [...state.skipped.filter((e) => e.key !== entry.key), entry];
    ctx.flags.changed = true;
    const next = nextSlotOf(state);
    return text(
      `已记下用户不提供「${entry.label}」，以后不会再问。${next ? `\n下一个目标：\n${describeSlot(next)}` : "\n下一个目标：无，信息已基本完整。"}`,
    );
  });

  const resolveConflictTool = tool(
    "resolve_conflict",
    "确认矛盾",
    ResolveConflictArgs,
    (args: z.infer<typeof ResolveConflictArgs>) => {
      if (state.conflicts.length === 0)
        return text("当前没有待确认的矛盾，不需要调用 resolve_conflict。", true);
      const conflict = args.factId
        ? state.conflicts.find((c) => c.factId === args.factId)
        : state.conflicts.find((c) => c.field === args.field);
      if (!conflict) {
        const known = state.conflicts.map((c) => `factId=${c.factId}（${c.field}）`).join("、");
        return text(`找不到对应的矛盾，请用这些之一：${known}`, true);
      }
      if (ctx.verifyQuote && !quoteInCorpus(ctx.userCorpus, args.quote)) {
        return text(`quote「${args.quote}」不是用户说过的原话，请逐字摘抄用户表示选哪个的那句话。`, true);
      }
      const accept = args.choice === "proposed";
      const chosen = String(accept ? conflict.proposed : conflict.previous);
      for (const event of settleConflict(state, conflict.factId, accept)) {
        if (event.type === "ask") ctx.flags.asked = true;
        ctx.emit(event);
      }
      ctx.flags.changed = true;
      const lines = [`已按用户选择，${conflict.label}以「${chosen}」为准。`];
      if (state.conflicts.length > 0) {
        lines.push("还有矛盾待确认，已自动向用户发起确认，本轮请不要再追问其他内容，也不要调用 ask_user。");
      } else {
        const next = nextSlotOf(state);
        lines.push(next ? `下一个目标：\n${describeSlot(next)}` : "下一个目标：无，信息已基本完整。");
      }
      return text(lines.join("\n"));
    },
  );

  return [upsertFacts, askUser, completeSection, skipField, resolveConflictTool];
}
