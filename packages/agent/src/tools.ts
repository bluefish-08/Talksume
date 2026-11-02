import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import type { ProfileSection } from "@talksume/core";
import type { z } from "zod";
import { computeCompleteness, pickNextSlot, SECTION_BY_NAME, type Slot } from "./completeness.ts";
import { applyFacts, type Conflict, describeDrafted, draftLabel, draftMissing } from "./facts.ts";
import { describeSlot } from "./prompt.ts";
import {
  AskUserArgs,
  CompleteSectionArgs,
  cleanQuickReplies,
  type FactInput,
  formatZodIssues,
  TOOL_SPECS,
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
  flags: { asked: boolean; changed: boolean };
}

export function normalizeQuote(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

export function buildUserCorpus(texts: readonly string[]): string {
  return texts.map(normalizeQuote).join("|");
}

function text(value: string, isError = false): AgentToolResult<unknown> {
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
function draftSlot(state: IntakeState): Slot | null {
  for (const draft of state.drafts) {
    const spec = SECTION_BY_NAME[draft.section];
    const id = String(draft.item.id);
    for (const field of draftMissing(draft)) {
      const key = `${draft.section}:${id}:${field}`;
      if ((state.askCounts[key] ?? 0) >= 2) continue;
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
  const draft = draftSlot(state);
  if (draft) return draft;
  return pickNextSlot(state.profile, {
    completedSections: state.completedSections,
    askCounts: state.askCounts,
  });
}

export function noteAsked(state: IntakeState, slot: Slot | null): void {
  if (slot) state.askCounts[slot.key] = (state.askCounts[slot.key] ?? 0) + 1;
}

export function confirmQuestion(conflict: Conflict): string {
  const label = conflict.label;
  return `你之前说${label}是「${String(conflict.previous)}」，刚才说的是「${String(conflict.proposed)}」，以哪个为准？`;
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

function tool(
  name: (typeof TOOL_SPECS)[number]["name"],
  label: string,
  schema: z.ZodType,
  execute: (params: never) => AgentToolResult<unknown>,
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
        if (ctx.verifyQuote && !ctx.userCorpus.includes(normalizeQuote(input.quote))) {
          rejected.push(`第 ${index + 1} 条：quote「${input.quote}」不是用户说过的原话，请逐字摘抄用户的话`);
        } else accepted.push({ input, index });
      });

      const result = applyFacts(
        state.profile,
        accepted.map((a) => a.input),
        { messageId: ctx.messageId, genId: ctx.genId, drafts: state.drafts },
      );
      for (const r of result.rejected) {
        rejected.push(`第 ${(accepted[r.index]?.index ?? r.index) + 1} 条：${r.reason}`);
      }

      state.profile = result.profile;
      state.drafts = result.drafts;
      state.facts.push(...result.facts);
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
          `有 ${result.conflicts.length} 处与已记录内容矛盾，已自动向用户发起确认，本轮请不要再追问其他内容，也不要调用 ask_user。`,
        );
      }
      if (result.drafted.length > 0) lines.push(result.drafted.map(describeDrafted).join("\n"));
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
    const quickReplies = cleanQuickReplies(args.quickReplies);
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
        if (!args.quote || (ctx.verifyQuote && !ctx.userCorpus.includes(normalizeQuote(args.quote)))) {
          return text("user_skipped 必须附带用户表示没有/不想提供的原话 quote。", true);
        }
      } else {
        const missing = computeCompleteness(state.profile)
          .missing.filter((m) => m.section === section && m.required && m.kind === "field")
          .map((m) => m.label);
        const empty = computeCompleteness(state.profile).missing.some(
          (m) => m.section === section && m.kind === "new_item" && m.required,
        );
        if (missing.length > 0 || empty) {
          return text(
            `「${label}」还缺必填信息：${missing.join("、") || "至少一条记录"}。请先追问，或在用户明确不想提供时用 user_skipped。`,
            true,
          );
        }
      }
      if (!state.completedSections.includes(section)) state.completedSections.push(section);
      const next = nextSlotOf(state);
      return text(
        `已完成「${label}」。${next ? `\n下一个目标：\n${describeSlot(next)}` : "\n所有分区均已完成。"}`,
      );
    },
  );

  return [upsertFacts, askUser, completeSection];
}
