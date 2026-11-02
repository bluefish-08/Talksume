import {
  Award,
  Education,
  Experience,
  type Fact,
  type Profile,
  type ProfileSection,
  Project,
  Skill,
} from "@talksume/core";
import type { z } from "zod";
import { SECTION_BY_NAME } from "./completeness.ts";
import { type FactInput, formatZodIssues, SectionPayload } from "./schemas.ts";

type Rec = Record<string, unknown>;
type ListSection = "education" | "experiences" | "projects" | "skills" | "awards";
type ObjectSection = "basics" | "intention";

export interface ProfileChange {
  section: ProfileSection;
  itemId?: string;
  field: string;
  value: unknown;
  previous?: unknown;
}

export interface Conflict {
  factId: string;
  section: ProfileSection;
  itemId?: string;
  field: string;
  label: string;
  previous: unknown;
  proposed: unknown;
  quote: string;
}

export interface RejectedFact {
  index: number;
  reason: string;
}

export interface ApplyContext {
  messageId: string;
  genId?: (prefix: string) => string;
}

export interface ApplyResult {
  profile: Profile;
  /** 本次新增的事实记录：已写入的为 confirmed，与旧值矛盾的为 pending。 */
  facts: Fact[];
  conflicts: Conflict[];
  rejected: RejectedFact[];
  changes: ProfileChange[];
}

const ITEM_SCHEMA: Record<ListSection, z.ZodType> = {
  education: Education,
  experiences: Experience,
  projects: Project,
  skills: Skill,
  awards: Award,
};

const ITEM_KEY: Record<ListSection, string> = {
  education: "school",
  experiences: "company",
  projects: "name",
  skills: "name",
  awards: "name",
};

const ID_PREFIX: Record<ProfileSection, string> = {
  basics: "bas",
  education: "edu",
  experiences: "exp",
  projects: "prj",
  skills: "skl",
  awards: "awd",
  intention: "int",
};

export function createIdGenerator(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}_${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function isList(section: ProfileSection): section is ListSection {
  return section !== "basics" && section !== "intention";
}

function normKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function blank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

function cleanValue(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return normKey(a) === normKey(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

function union(existing: unknown[], incoming: unknown[]): unknown[] {
  const out = [...existing];
  for (const v of incoming) if (!out.some((x) => sameValue(x, v))) out.push(v);
  return out;
}

function fieldLabel(section: ProfileSection, field: string): string {
  return SECTION_BY_NAME[section].fields.find((f) => f.field === field)?.label ?? field;
}

interface MergeOutcome {
  applied: Rec;
  conflicted: Rec;
  changes: ProfileChange[];
}

/** 把 payload 合并进 target（原地修改）：数组取并集，标量与旧值不同则记为冲突而不覆盖。 */
function mergeInto(
  target: Rec,
  payload: Rec,
  section: ProfileSection,
  itemId: string | undefined,
): MergeOutcome {
  const outcome: MergeOutcome = { applied: {}, conflicted: {}, changes: [] };
  for (const [field, raw] of Object.entries(payload)) {
    if (blank(raw)) continue;
    const incoming = cleanValue(raw);
    const existing = target[field];
    if (Array.isArray(incoming)) {
      const merged = union(Array.isArray(existing) ? existing : [], incoming.map(cleanValue));
      if (!Array.isArray(existing) || merged.length !== existing.length) {
        target[field] = merged;
        outcome.applied[field] = incoming;
        outcome.changes.push({
          section,
          ...(itemId ? { itemId } : {}),
          field,
          value: merged,
          previous: existing,
        });
      }
      continue;
    }
    if (blank(existing)) {
      target[field] = incoming;
      outcome.applied[field] = incoming;
      outcome.changes.push({ section, ...(itemId ? { itemId } : {}), field, value: incoming });
    } else if (!sameValue(existing, incoming)) {
      outcome.conflicted[field] = incoming;
    }
  }
  return outcome;
}

function describeRequired(section: ListSection, error: z.ZodError): string {
  const fields = [...new Set(error.issues.map((i) => String(i.path[0] ?? "")))]
    .filter((f) => f && f !== "id" && f !== "sourceFactIds")
    .map((f) => `${f}（${fieldLabel(section, f)}）`);
  return `新建${SECTION_BY_NAME[section].label}缺少必填字段 ${fields.join("、") || formatZodIssues(error)}，请先向用户问清楚再写入`;
}

export function applyFacts(
  profile: Profile,
  inputs: readonly FactInput[],
  context: ApplyContext,
): ApplyResult {
  const genId = context.genId ?? createIdGenerator();
  const next = structuredClone(profile);
  const result: ApplyResult = { profile: next, facts: [], conflicts: [], rejected: [], changes: [] };

  for (const [index, input] of inputs.entries()) {
    const reject = (reason: string) => result.rejected.push({ index, reason });
    const section = input.section;
    const parsed = (SectionPayload[section] as z.ZodType<Rec>).safeParse(input.payload);
    if (!parsed.success) {
      reject(`${section} 的字段不合法：${formatZodIssues(parsed.error)}`);
      continue;
    }
    if (!input.quote?.trim()) {
      reject("缺少用户原话 quote");
      continue;
    }
    const payload = parsed.data;
    const factId = genId("fact");

    let outcome: MergeOutcome;
    let itemId: string | undefined;

    if (!isList(section)) {
      outcome = mergeInto(next[section as ObjectSection] as Rec, payload, section, undefined);
    } else {
      const list = next[section] as unknown as Rec[];
      const keyField = ITEM_KEY[section];
      const keyValue = normKey(payload[keyField]);
      if (!keyValue) {
        reject(`${section} 缺少 ${keyField}`);
        continue;
      }
      const existing = list.find((item) => normKey(item[keyField]) === keyValue);
      if (existing) {
        itemId = String(existing.id);
        const { [keyField]: _key, ...rest } = payload;
        outcome = mergeInto(existing, rest, section, itemId);
        if (Object.keys(outcome.applied).length > 0) {
          existing.sourceFactIds = union(existing.sourceFactIds as unknown[], [factId]);
        }
      } else {
        itemId = genId(ID_PREFIX[section]);
        const candidate: Rec = { id: itemId, sourceFactIds: [factId] };
        outcome = mergeInto(candidate, payload, section, itemId);
        const checked = ITEM_SCHEMA[section].safeParse(candidate);
        if (!checked.success) {
          reject(describeRequired(section, checked.error));
          continue;
        }
        list.push(checked.data as Rec);
        outcome.changes = [{ section, itemId, field: "_item", value: checked.data }];
      }
    }

    result.changes.push(...outcome.changes);
    const base = { section, quote: input.quote.trim(), sourceMessageId: context.messageId };
    const keyPayload = isList(section) ? { [ITEM_KEY[section]]: payload[ITEM_KEY[section]] } : {};
    if (Object.keys(outcome.applied).length > 0 || Object.keys(outcome.conflicted).length === 0) {
      result.facts.push({
        id: factId,
        ...base,
        payload: { ...keyPayload, ...outcome.applied },
        status: "confirmed",
      });
    }
    for (const [field, proposed] of Object.entries(outcome.conflicted)) {
      const pendingId = genId("fact");
      result.facts.push({
        id: pendingId,
        ...base,
        payload: { ...keyPayload, [field]: proposed },
        status: "pending",
      });
      const container = isList(section)
        ? ((next[section] as unknown as Rec[]).find((item) => item.id === itemId) as Rec)
        : (next[section as ObjectSection] as Rec);
      result.conflicts.push({
        factId: pendingId,
        section,
        ...(itemId ? { itemId } : {}),
        field,
        label: fieldLabel(section, field),
        previous: container[field],
        proposed,
        quote: base.quote,
      });
    }
  }

  return result;
}

export interface ResolveResult {
  profile: Profile;
  facts: Fact[];
  changes: ProfileChange[];
}

/** 用户确认矛盾：accept 用新值覆盖并让旧事实作废；否则丢弃新事实。 */
export function resolveConflict(
  profile: Profile,
  facts: readonly Fact[],
  conflict: Conflict,
  accept: boolean,
): ResolveResult {
  const next = structuredClone(profile);
  const changes: ProfileChange[] = [];
  const updated = facts.map((fact) => ({ ...fact }));
  const pending = updated.find((f) => f.id === conflict.factId);

  if (accept) {
    const container = isList(conflict.section)
      ? (next[conflict.section] as unknown as Rec[]).find((item) => item.id === conflict.itemId)
      : (next[conflict.section as ObjectSection] as Rec);
    if (container) {
      for (const fact of updated) {
        if (
          fact.status === "confirmed" &&
          fact.section === conflict.section &&
          sameValue(fact.payload[conflict.field], conflict.previous)
        ) {
          fact.status = "superseded";
        }
      }
      container[conflict.field] = conflict.proposed;
      if (isList(conflict.section)) {
        container.sourceFactIds = union((container.sourceFactIds as unknown[]) ?? [], [conflict.factId]);
      }
      changes.push({
        section: conflict.section,
        ...(conflict.itemId ? { itemId: conflict.itemId } : {}),
        field: conflict.field,
        value: conflict.proposed,
        previous: conflict.previous,
      });
      if (pending) pending.status = "confirmed";
    }
  } else if (pending) {
    pending.status = "superseded";
  }
  return { profile: next, facts: updated, changes };
}
