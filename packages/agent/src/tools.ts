import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import type { ProfileSection } from "@talksume/core";
import type { z } from "zod";
import {
  computeCompleteness,
  isQuantified,
  isSkipped,
  type MissingField,
  OPTIONAL_BUDGET,
  pickNextSlot,
  SECTION_BY_NAME,
  type Slot,
  toSlot,
} from "./completeness.ts";
import {
  applyFacts,
  bigrams,
  type Conflict,
  coverage,
  describeDrafted,
  draftLabel,
  draftMissing,
  draftQuestion,
  resolveConflict,
} from "./facts.ts";
import { liftSkips, type SkipEntry, sectionSkipEntry, skipEntryOf, skippedKeys } from "./memory.ts";
import { describeSlot, wrapGuide } from "./prompt.ts";
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
import type { IntakeEvent, IntakeState, Plan, SlotRef } from "./types.ts";

export interface RunContext {
  state: IntakeState;
  messageId: string;
  /** 本轮用户这句话；没有时（系统通知触发的一轮）不拦截 skip_field。 */
  userText?: string;
  /** 所有用户发言归一化后的拼接，用于核对 quote 确为原话。 */
  userCorpus: string;
  verifyQuote: boolean;
  genId: (prefix: string) => string;
  emit(event: IntakeEvent): void;
  /** rejected：本轮有 upsert_facts 条目被拒，等待模型修正。 */
  flags: { asked: boolean; changed: boolean; jobs?: boolean; rejected?: boolean; styled?: boolean };
  /** 本轮已经说出口的正文。 */
  spoken?: () => string;
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

/** 暂存的条目优先补齐，问过两次仍不答就放过，回到正常顺序。占位条目只问它是什么，不算必填。 */
function draftSlot(state: IntakeState, skipped: ReadonlySet<string>): Slot | null {
  for (const draft of state.drafts) {
    const spec = SECTION_BY_NAME[draft.section];
    const id = String(draft.item.id);
    const placeholder = draftQuestion(draft);
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
        required: !placeholder,
        kind: "field",
        question: placeholder ?? f?.question ?? `请补充${f?.label ?? field}`,
        strategy: placeholder ? PLACEHOLDER_STRATEGY : (f?.strategy ?? ""),
      };
    }
  }
  return null;
}

const PLACEHOLDER_STRATEGY =
  "用户只说了做过、没说做的是什么。只问这一件事，不要问角色、技术栈。用户一说出名称或做的是什么，这一轮必须调用 upsert_facts，用用户的说法写 name（连同他说的其他内容），系统会并进这条占位；不写的话名字不会记下，也不要再用泛称写。";

/** 最近写入的事实落在哪段实习或项目上。 */
function focusItemOf(state: IntakeState): string | undefined {
  for (const fact of [...state.facts].reverse()) {
    if (fact.status !== "confirmed") continue;
    if (fact.section !== "experiences" && fact.section !== "projects") continue;
    const items = state.profile[fact.section] as { id: string; sourceFactIds: string[] }[];
    const hit = items.find((item) => item.sourceFactIds.includes(fact.id));
    if (hit) return hit.id;
  }
  return undefined;
}

export function nextSlotOf(state: IntakeState): Slot | null {
  const skipped = skippedKeys(state);
  const draft = draftSlot(state, skipped);
  if (draft) return draft;
  const focusItemId = focusItemOf(state);
  return pickNextSlot(state.profile, {
    completedSections: state.completedSections,
    askCounts: state.askCounts,
    optionalBudget: OPTIONAL_BUDGET,
    skipped,
    ...(focusItemId ? { focusItemId } : {}),
  });
}

/** 收尾之后用户只回的致谢或客套，不需要模型。 */
const PLEASANTRY =
  /^(?:好的?|好嘞|嗯|哦|噢|行|可以|ok|okay|谢谢|谢了|多谢|感谢|辛苦|收到|明白|了解|知道|拜拜|再见|晚安|太好了|不错|很好|棒|没问题|你|您|啦|呀|啊|哈|了|的|吧|呢|哇|真|太|非常|很)+$/i;

export const isPleasantry = (text: string): boolean => PLEASANTRY.test(normalizeQuote(text));

export function isClosed(state: IntakeState): boolean {
  return state.history.some((t) => t.role === "assistant" && t.meta?.closed);
}

/** 下一步只由这里决定：已收尾不再问，有下一项就问，没有下一项就收尾（有待确认的矛盾时先等着）。 */
export function planNext(state: IntakeState): Plan {
  if (isClosed(state)) return { kind: "closed" };
  const slot = nextSlotOf(state);
  if (slot) return { kind: "ask", slot };
  return state.conflicts.length > 0 ? { kind: "hold" } : { kind: "wrap" };
}

/** 给模型的本轮指令，系统提示和每个工具的返回都用它。 */
export function planGuidance(state: IntakeState, plan: Plan): string {
  if (plan.kind === "ask") {
    return `下一个目标：\n${describeSlot(plan.slot)}\n这一轮只问这一项，写成一句话，不要换成别的问题，也不要收尾。`;
  }
  if (plan.kind === "wrap") {
    const { tips } = computeCompleteness(state.profile, { completedSections: state.completedSections });
    return `下一个目标：无，本轮收尾。${wrapGuide(tips.length > 0)}这一轮不要提问。`;
  }
  if (plan.kind === "closed") {
    return "下一个目标：无，已经收尾过了。回应完用户这一句就结束，不要提问，也不要再总结收尾。";
  }
  return "下一个目标：无，有待确认的矛盾，系统已发起确认。本轮不要追问其他内容。";
}

const NO_NUMBERS =
  /没(?:有)?(?:什么|啥)?(?:具体|准确|明确)?的?(?:数字|数据|量化|统计)|没(?:有)?(?:统计|量化)过?|记不(?:清|得|太清)|不记得|忘了|说不上来/;
const NOTHING_TO_SAY =
  /没(?:有)?遇到|没(?:有)?(?:什么|啥)?(?:特别|太|很)?(?:难|挑战|问题|可说|好说)|没有|没(?:有)?(?:做|参加|干|弄|写|学|用)过|记不(?:清|得|太清)|不记得|忘了|想不起来|说不上来|跳过|不想说/;
/** 超过这个长度或带了英文、数字的回答多半含有内容，交给模型去写。 */
const SHORT_DECLINE = 12;

const DECLINE = /没|无|不(?:想|愿|方便|用|要|太|打算|清楚|知道|记得|填|写|说)|算了|跳过|忘了|想不起|pass/i;

/** 这句话里有没有拒答的字眼；闲聊和没有信息的消息没有，不能据此跳过任何字段。 */
export const declines = (text: string): boolean => DECLINE.test(text);

/** 上一轮追问的字段 key。 */
export function lastAskedKey(state: IntakeState): string | undefined {
  return state.history.findLast((t) => t.role === "assistant")?.meta?.slot;
}

function declineOf(m: MissingField, text: string): string | undefined {
  if (m.kind === "quantify") return isQuantified(text) ? undefined : text.match(NO_NUMBERS)?.[0];
  if (!m.depth && m.kind !== "probe") return undefined;
  const plain = normalizeQuote(text);
  if (plain.length > SHORT_DECLINE || /[a-z0-9]/.test(plain)) return undefined;
  return NOTHING_TO_SAY.test(text) ? text.trim() : undefined;
}

/**
 * 上一轮问的深挖项或挖掘角度，用户这轮答了实质内容（不是简短的「没有」）：返回该项名称，
 * 模型没写入也没跳过时用来提醒它补写。
 */
export function answeredSlot(state: IntakeState, text: string): string | undefined {
  const key = lastAskedKey(state);
  if (!key) return undefined;
  const { missing } = computeCompleteness(state.profile, { completedSections: state.completedSections });
  const slot = missing.find((m) => m.key === key);
  if (!slot || !(slot.depth || slot.kind === "probe") || declineOf(slot, text)) return undefined;
  if (normalizeQuote(text).length <= SHORT_DECLINE) return undefined;
  return `${slot.itemLabel ? `「${slot.itemLabel}」的` : ""}${slot.label}`;
}

/** 上一轮问的是深挖项，用户答没有、没遇到、记不清时直接记为跳过，不指望模型记得调用 skip_field。 */
export function skipDeclined(state: IntakeState, text: string): SkipEntry | null {
  const key = lastAskedKey(state);
  if (!key) return null;
  const { missing } = computeCompleteness(state.profile, { completedSections: state.completedSections });
  const slot = missing.find((m) => m.key === key);
  const quote = slot && declineOf(slot, text);
  return slot && quote ? skipSlot(state, toSlot(slot), quote) : null;
}

export function skipSlot(state: IntakeState, slot: Slot, quote: string): SkipEntry {
  const entry = skipEntryOf(slot, quote);
  state.skipped = [...state.skipped.filter((e) => e.key !== entry.key), entry];
  return entry;
}

/** 可被 skip_field 跳过的字段：暂存条目的缺项和画像里仍缺的项。 */
export function skippableSlot(state: IntakeState, key: string): Slot | null {
  const draft = draftSlot(state, new Set());
  if (draft?.key === key) return draft;
  const { missing } = computeCompleteness(state.profile, { completedSections: state.completedSections });
  const hit = missing.find((m) => m.key === key);
  return hit ? toSlot(hit) : null;
}

/** key 指向的字段已有内容或分区已完成：跳过无从谈起，也不算失败。 */
function alreadySettled(state: IntakeState, key: string): boolean {
  const [section, itemId, field] = key.split(":");
  const spec = SECTION_BY_NAME[section as ProfileSection] as
    | (typeof SECTION_BY_NAME)[ProfileSection]
    | undefined;
  if (!spec) return false;
  if (state.completedSections.includes(spec.section)) return true;
  if (!itemId || !field || !spec.fields.some((f) => f.field === field)) return false;
  const items = spec.kind === "list" ? (state.profile[spec.section] as { id: string }[]) : undefined;
  if (items ? !items.some((i) => i.id === itemId) : itemId !== "_") return false;
  return !skippableSlot(state, key);
}

const PROBE_ANSWERED = 99;

/** 实习和项目条目数，含暂存的。 */
function evidenceCount(state: IntakeState): number {
  const drafted = state.drafts.filter((d) => d.section === "experiences" || d.section === "projects").length;
  return state.profile.experiences.length + state.profile.projects.length + drafted;
}

/** 上一轮问的挖掘角度挖出了新经历（哪怕只是占位），这个角度就算问完，不再重复问。 */
function settleProbe(state: IntakeState, before: number): void {
  const key = lastAskedKey(state);
  if (!key?.startsWith("projects:_:probe_")) return;
  if (evidenceCount(state) > before) state.askCounts[key] = PROBE_ANSWERED;
}

const BARE_CONFIRM =
  /^(?:是的?|对的?|嗯+|有的?|做过|用过|学过|会的?|参加过|没错|当然|好的?)+(?:啊|呀|吧|呢)?$/;
const UNCHECKED_KEYS = new Set([
  "kind",
  "degree",
  "category",
  "level",
  "jobType",
  "start",
  "end",
  "date",
  "links",
]);

function textLeaves(payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (UNCHECKED_KEYS.has(key)) continue;
    if (key === "highlights" && Array.isArray(value)) {
      for (const h of value) if (typeof h?.detail === "string") out.push(h.detail);
    } else if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) out.push(...value.filter((v): v is string => typeof v === "string"));
  }
  return out;
}

/**
 * 用户只回了「做过」「用过」这类确认时，能写的只有上一句问到的候选和用户自己说过的内容；
 * 返回两边都找不到出处的值。
 */
export function unconfirmedValues(
  payload: Record<string, unknown>,
  quote: string,
  userCorpus: string,
  question: string,
): string[] {
  if (!BARE_CONFIRM.test(normalizeQuote(quote))) return [];
  const grounds = bigrams(`${userCorpus}|${question}`);
  const plainGrounds = `${userCorpus}|${normalizeQuote(question)}`;
  return textLeaves(payload).filter((value) => {
    const plain = normalizeQuote(value);
    if (plain.length < 2 || plainGrounds.includes(plain)) return false;
    return coverage(bigrams(value), grounds) < 0.8;
  });
}

const WRAP_UP =
  /(?:基本|差不多|都)(?:就)?齐了|右侧(?:的)?(?:预览|就是)|(?:可以|直接)导出|(?:基本|比较|已经)(?:收集)?完整|先到这里|就到这里/;

/** 一句话是不是收尾说法；还要问下一项时，模型自己写的收尾句会被拦下。 */
export const wrapsUp = (sentence: string) => WRAP_UP.test(sentence);

/** 代码选好的目标，模型没问出口时由代码替它问；有条目名就带上，免得问得像没头没尾。 */
export function slotQuestion(slot: Slot): string {
  return slot.itemLabel && slot.kind !== "field" ? `「${slot.itemLabel}」：${slot.question}` : slot.question;
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

  // 这一轮已经问过，再给「下一个目标」模型会照着再问一遍
  const nextTarget = (): string => {
    const plan = planNext(state);
    if (plan.kind === "ask" && /[?？]/.test(ctx.spoken?.() ?? "")) {
      return "这一轮的回复里已经提过问题了：写完就结束，不要再输出文字，也不要换个说法再问；需要快捷回答就调用 ask_user，question 照抄正文里那句。";
    }
    return planGuidance(state, plan);
  };

  const upsertFacts = tool(
    "upsert_facts",
    "写入事实",
    UpsertFactsArgs,
    (args: z.infer<typeof UpsertFactsArgs>) => {
      const rejected: string[] = [];
      const accepted: { input: FactInput; index: number }[] = [];
      const question = state.history.findLast((t) => t.role === "assistant")?.content ?? "";
      args.facts.forEach((input, index) => {
        if (ctx.verifyQuote && !quoteInCorpus(ctx.userCorpus, input.quote)) {
          rejected.push(
            `第 ${index + 1} 条：quote「${input.quote}」不是用户说过的原话，请逐字摘抄；不相邻的片段用 … 分隔，每段至少 ${MIN_QUOTE_SEGMENT} 个字`,
          );
          return;
        }
        const unconfirmed = ctx.verifyQuote
          ? unconfirmedValues(input.payload as Record<string, unknown>, input.quote, ctx.userCorpus, question)
          : [];
        if (unconfirmed.length > 0) {
          rejected.push(
            `第 ${index + 1} 条：「${input.quote}」只是确认你上一句问的内容，「${unconfirmed.join("」「")}」用户没说过、你也没问过，不能写；只写用户确认的那件事，其余先问清楚`,
          );
        } else accepted.push({ input, index });
      });
      const evidenceBefore = evidenceCount(state);

      const result = applyFacts(
        state.profile,
        accepted.map((a) => a.input),
        {
          messageId: ctx.messageId,
          genId: ctx.genId,
          drafts: state.drafts,
          facts: state.facts,
          userText: ctx.userCorpus,
        },
      );
      for (const r of result.rejected) {
        rejected.push(`第 ${(accepted[r.index]?.index ?? r.index) + 1} 条：${r.reason}`);
      }

      state.profile = result.profile;
      state.drafts = result.drafts;
      state.facts.push(...result.facts);
      liftSkips(state, result.changes);
      settleProbe(state, evidenceBefore);
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
      if (result.unchanged.length > 0) {
        const which = result.unchanged.map((i) => (accepted[i]?.index ?? i) + 1).join("、");
        lines.push(`第 ${which} 条和已记录的内容一样，不用重复写入。`);
      }
      if (result.drafted.length > 0) lines.push(result.drafted.map(describeDrafted).join("\n"));
      if (result.dropped.length > 0) {
        const dropped = result.dropped.map(
          (d) => `第 ${(accepted[d.index]?.index ?? d.index) + 1} 条的 ${d.field}：${d.reason}`,
        );
        lines.push(`已忽略这些推测字段（事实其余部分照常写入），用户没说就留空：\n${dropped.join("\n")}`);
      }
      if (result.reverted.length > 0) {
        const reverted = result.reverted.map(
          (d) => `第 ${(accepted[d.index]?.index ?? d.index) + 1} 条：${d.reason}`,
        );
        lines.push(`这些写法超出了用户原话，已按原话写入，不用重写：\n${reverted.join("\n")}`);
      }
      if (rejected.length > 0) {
        ctx.flags.rejected = true;
        lines.push(`被拒绝：\n${rejected.join("\n")}`);
      }
      lines.push(nextTarget());
      return text(lines.join("\n"), confirmed === 0 && result.conflicts.length === 0 && rejected.length > 0);
    },
  );

  const askUser = tool("ask_user", "追问", AskUserArgs, (args: z.infer<typeof AskUserArgs>) => {
    if (ctx.flags.asked) return { ...text("本轮已经向用户提问，不要重复提问。"), terminate: true };
    const plan = planNext(state);
    if (plan.kind !== "ask")
      return { ...text("这一轮不再提问：直接结束，不要再输出文字。"), terminate: true };
    const { slot } = plan;
    ctx.flags.asked = true;
    noteAsked(state, slot);
    const given = cleanQuickReplies(args.quickReplies);
    const quickReplies = given.length > 0 ? given : cleanQuickReplies(slot.replies);
    ctx.emit({
      type: "ask",
      kind: "followup",
      question: args.question,
      slot: slotRef(slot),
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
        if (ctx.userText !== undefined && !declines(ctx.userText)) {
          return text("用户这条消息没有表示没有或不想提供，不能把整个分区记为跳过。", true);
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
      return text(`已完成「${label}」。\n${nextTarget()}`);
    },
  );

  const skipField = tool("skip_field", "跳过字段", SkipFieldArgs, (args: z.infer<typeof SkipFieldArgs>) => {
    if (ctx.verifyQuote && !quoteInCorpus(ctx.userCorpus, args.quote)) {
      return text(`quote「${args.quote}」不是用户说过的原话，请逐字摘抄用户表示没有/不想说的那句话。`, true);
    }
    if (ctx.userText !== undefined && !declines(ctx.userText)) {
      return text(
        "用户这条消息没有拒答（没说没有、不想说、记不清），不能跳过任何字段：回应这一句，再按本轮的目标继续。",
        true,
      );
    }
    const asked = lastAskedKey(state);
    const slot = asked ? skippableSlot(state, asked) : null;
    if (!slot) {
      if (asked && alreadySettled(state, asked)) {
        return text("上一轮问的字段已有内容或已跳过，不需要跳过，直接回应用户。");
      }
      return text("只能跳过上一轮问过、用户拒答的那一项，现在没有这样的字段。", true);
    }
    if (args.key && args.key !== slot.key && args.key.split(":").at(-1) !== slot.field) {
      return text(`只能跳过上一轮问的那一项：key=${slot.key}（${slot.label}）。`, true);
    }
    return skipped(skipSlot(state, slot, args.quote));
  });

  function skipped(entry: SkipEntry, note = ""): AgentToolResult<unknown> {
    ctx.flags.changed = true;
    return text(`${note}已记下用户不提供「${entry.label}」，以后不会再问。\n${nextTarget()}`);
  }

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
        lines.push(nextTarget());
      }
      return text(lines.join("\n"));
    },
  );

  return [upsertFacts, askUser, completeSection, skipField, resolveConflictTool];
}
