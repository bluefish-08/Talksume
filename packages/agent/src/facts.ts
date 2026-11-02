import {
  Award,
  Education,
  Experience,
  type Fact,
  type Highlight,
  type Profile,
  type ProfileSection,
  Project,
  Skill,
} from "@talksume/core";
import type { z } from "zod";
import { SECTION_BY_NAME } from "./completeness.ts";
import { type FactInput, formatZodIssues, SectionPayload } from "./schemas.ts";

type Rec = Record<string, unknown>;
export type ListSection = "education" | "experiences" | "projects" | "skills" | "awards";
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
  /** 列表字段里的哪一项，如 highlights 的 title；此时 previous/proposed 是该项的 detail。 */
  entry?: string;
  label: string;
  previous: unknown;
  proposed: unknown;
  quote: string;
}

export interface RejectedFact {
  index: number;
  reason: string;
}

export interface DroppedField {
  index: number;
  field: string;
  reason: string;
}

export interface ApplyContext {
  messageId: string;
  /** 用户全部发言，核对要点里的数字时一并参考。 */
  userText?: string;
  genId?: (prefix: string) => string;
  drafts?: readonly Draft[];
}

/** 必填项还没问齐的新条目，先暂存，补齐后再写进画像。 */
export interface Draft {
  section: ListSection;
  item: Rec;
}

export interface Drafted {
  section: ListSection;
  label: string;
  missing: string[];
}

export interface ApplyResult {
  profile: Profile;
  /** 本次新增的事实记录：已写入的为 confirmed，与旧值矛盾的为 pending。 */
  facts: Fact[];
  conflicts: Conflict[];
  rejected: RejectedFact[];
  /** 原话里找不到依据、被丢掉的推测字段；事实本身照常写入。 */
  dropped: DroppedField[];
  changes: ProfileChange[];
  drafts: Draft[];
  drafted: Drafted[];
}

export const LEVEL_WORDS = {
  beginner: ["了解", "入门", "初学"],
  familiar: ["熟悉"],
  proficient: ["熟练", "擅长"],
  expert: ["精通"],
} as const satisfies Record<NonNullable<Skill["level"]>, readonly string[]>;

const DATE_LIKE = /\d{2,4}\s*[年.\-/]|\d{4}|[〇零一二三四五六七八九]{2,4}年|[去今前]年|\d{1,2}\s*月/;

/** 熟练度和获奖日期最常被推测，只在原话里有对应字样时保留。 */
function dropUngrounded(
  section: ProfileSection,
  payload: Rec,
  quote: string,
  userText = "",
): Omit<DroppedField, "index">[] {
  const dropped: Omit<DroppedField, "index">[] = [];
  if (section === "skills" && typeof payload.level === "string") {
    const words: readonly string[] = LEVEL_WORDS[payload.level as keyof typeof LEVEL_WORDS] ?? [];
    if (!words.some((w) => quote.includes(w))) {
      dropped.push({ field: "level", reason: `原话里没有「${words.join("/")}」等程度词` });
      delete payload.level;
    }
  }
  if (section === "awards" && payload.date !== undefined && !DATE_LIKE.test(quote)) {
    dropped.push({ field: "date", reason: "原话里没有年份或日期" });
    delete payload.date;
  }
  if (Array.isArray(payload.highlights)) {
    payload.highlights = (payload.highlights as Highlight[]).filter((h) => {
      const missing = ungroundedNumbers(`${h.title ?? ""} ${h.detail}`, `${quote}|${userText}`);
      if (missing.length === 0) return true;
      dropped.push({
        field: "highlights",
        reason: `要点「${h.title ?? h.detail.slice(0, 10)}」里的 ${missing.join("、")} 在原话里找不到`,
      });
      return false;
    });
  }
  return dropped;
}

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/** 数字必须出自原话；个位数允许原话用汉字写。 */
export function ungroundedNumbers(text: string, quote: string): string[] {
  const plain = quote.replace(/[\s,，]/g, "");
  return [...new Set(text.match(/\d+(?:\.\d+)?/g) ?? [])].filter((n) => {
    if (plain.includes(n) || plain.includes(n.replace(".", ""))) return false;
    const small = Number(n);
    if (Number.isInteger(small) && small <= 10) {
      return !(plain.includes(CN_DIGITS[small] as string) || (small === 2 && plain.includes("两")));
    }
    return true;
  });
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

/** 新说法完整包含旧说法，视为补充或细化而不是矛盾。 */
function refines(existing: unknown, incoming: unknown): boolean {
  if (typeof existing !== "string" || typeof incoming !== "string") return false;
  const before = normKey(existing);
  const after = normKey(incoming);
  return after.length > before.length && after.includes(before);
}

const NARRATIVE_FIELDS: Partial<Record<ProfileSection, readonly string[]>> = {
  basics: ["summary"],
  projects: ["situation", "task", "action", "result"],
  awards: ["description"],
};

type NarrativeMerge = { kind: "conflict" } | { kind: "keep" } | { kind: "set"; value: string };

const ANCHOR = /\d+(?:\.\d+)?|[a-z][a-z0-9+#]*/g;

function anchorsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().match(ANCHOR) ?? []);
}

function bigrams(text: string): Set<string> {
  const plain = text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  const out = new Set<string>();
  for (let i = 0; i < plain.length - 1; i++) out.add(plain.slice(i, i + 2));
  return out;
}

function coverage(of: Set<string>, within: Set<string>): number {
  if (of.size === 0) return 1;
  let hit = 0;
  for (const g of of) if (within.has(g)) hit++;
  return hit / of.size;
}

const minus = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x));

/** 叙述字段的兜底：数字或专名被换掉才算矛盾；拿不准时宁可拼接，不弹确认。 */
function mergeNarrative(existing: string, incoming: string): NarrativeMerge {
  const before = anchorsOf(existing);
  const after = anchorsOf(incoming);
  const lost = minus(before, after);
  const added = minus(after, before);
  const isNum = (x: string) => /^\d/.test(x);
  if (lost.some(isNum) && added.some(isNum)) return { kind: "conflict" };
  if (lost.length > 0 && added.length > 0) {
    const strip = (t: string) => t.toLowerCase().replace(ANCHOR, "");
    if (coverage(bigrams(strip(existing)), bigrams(strip(incoming))) >= 0.6) return { kind: "conflict" };
  }
  const oldGrams = bigrams(existing);
  const newGrams = bigrams(incoming);
  if (added.length === 0 && coverage(newGrams, oldGrams) >= 0.8) return { kind: "keep" };
  if (lost.length === 0 && coverage(oldGrams, newGrams) >= 0.8) return { kind: "set", value: incoming };
  return { kind: "set", value: `${existing.replace(/[\s。；;，,]+$/u, "")}；${incoming}` };
}

function union(existing: unknown[], incoming: unknown[]): unknown[] {
  const out = [...existing];
  for (const v of incoming) if (!out.some((x) => sameValue(x, v))) out.push(v);
  return out;
}

const EXTRA_LABELS: Record<string, string> = {
  bullets: "工作内容",
  task: "任务",
  action: "具体做法",
  result: "结果",
  highlights: "经历要点",
  category: "技能分组",
  department: "部门",
  courses: "主修课程",
  honors: "在校荣誉",
};

function fieldLabel(section: ProfileSection, field: string): string {
  return (
    SECTION_BY_NAME[section].fields.find((f) => f.field === field)?.label ?? EXTRA_LABELS[field] ?? field
  );
}

/** 模型自己归的类，不是用户的说法：已有就不改，也不弹确认。 */
const SOFT_FIELDS: Partial<Record<ProfileSection, readonly string[]>> = { skills: ["category"] };

interface EntryConflict {
  entry: string;
  previous: string;
  proposed: string;
}

function linkKey(url: unknown): string {
  return normKey(url)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

function mergeLinks(existing: Rec[], incoming: Rec[]): Rec[] {
  const out = existing.map((l) => ({ ...l }));
  for (const link of incoming) {
    if (blank(link.url)) continue;
    const hit = out.find((l) => linkKey(l.url) === linkKey(link.url));
    if (!hit) out.push({ ...link, url: String(link.url).trim() });
    else if (blank(hit.label) && !blank(link.label)) hit.label = link.label;
  }
  return out;
}

/** 同 title 的要点合并 detail（走叙述字段规则）；无 title 时按 detail 包含关系去重。 */
function mergeHighlights(
  existing: Highlight[],
  incoming: Highlight[],
): { merged: Highlight[]; conflicts: EntryConflict[] } {
  const merged = existing.map((h) => ({ ...h }));
  const conflicts: EntryConflict[] = [];
  for (const raw of incoming) {
    const title = raw.title?.trim() || undefined;
    const detail = raw.detail.trim();
    if (!detail) continue;
    const byTitle = title ? merged.find((h) => h.title && normKey(h.title) === normKey(title)) : undefined;
    if (byTitle) {
      if (sameValue(byTitle.detail, detail) || refines(detail, byTitle.detail)) continue;
      if (refines(byTitle.detail, detail)) {
        byTitle.detail = detail;
        continue;
      }
      const narrative = mergeNarrative(byTitle.detail, detail);
      if (narrative.kind === "set") byTitle.detail = narrative.value;
      else if (narrative.kind === "conflict")
        conflicts.push({ entry: byTitle.title as string, previous: byTitle.detail, proposed: detail });
      continue;
    }
    const byDetail = merged.find(
      (h) =>
        (!title || !h.title) &&
        (sameValue(h.detail, detail) || refines(h.detail, detail) || refines(detail, h.detail)),
    );
    if (byDetail) {
      if (refines(byDetail.detail, detail)) byDetail.detail = detail;
      if (title && !byDetail.title) byDetail.title = title;
      continue;
    }
    merged.push(title ? { title, detail } : { detail });
  }
  return { merged, conflicts };
}

function cleanText(text: unknown): string {
  return (typeof text === "string" ? text : "").trim().replace(/[，。；;,.\s]+$/u, "");
}

/** 条目第一次有 highlights 时，旧 bullets 和项目的做法/结果转成无标题要点，免得简历上原有内容消失；背景不转，只是一句项目介绍。 */
function legacyHighlights(section: ProfileSection, target: Rec): Highlight[] {
  const texts =
    section === "experiences"
      ? ((target.bullets as unknown[]) ?? []).map(cleanText)
      : [cleanText(target.action), cleanText(target.result)];
  return texts.filter(Boolean).map((detail) => ({ detail }));
}

const CONVERTED_FIELDS: Partial<Record<ProfileSection, readonly string[]>> = {
  experiences: ["bullets"],
  projects: ["action", "result"],
};

interface MergeOutcome {
  applied: Rec;
  conflicted: Rec;
  entryConflicts: EntryConflict[];
  changes: ProfileChange[];
}

/** 把 payload 合并进 target（原地修改）：数组取并集，文字补充直接更新，其余标量与旧值不同则记为冲突而不覆盖。 */
function mergeInto(
  target: Rec,
  payload: Rec,
  section: ProfileSection,
  itemId: string | undefined,
): MergeOutcome {
  const outcome: MergeOutcome = { applied: {}, conflicted: {}, entryConflicts: [], changes: [] };
  const change = (field: string, value: unknown, previous?: unknown) =>
    outcome.changes.push({
      section,
      ...(itemId ? { itemId } : {}),
      field,
      value,
      ...(previous !== undefined ? { previous } : {}),
    });
  const rest = { ...payload };
  const converted = CONVERTED_FIELDS[section];
  if (converted) {
    const incoming = Array.isArray(rest.highlights) ? (rest.highlights as Highlight[]) : [];
    delete rest.highlights;
    const before = Array.isArray(target.highlights) ? (target.highlights as Highlight[]) : [];
    if (before.length > 0 || incoming.length > 0) {
      for (const field of converted) {
        const value = rest[field];
        if (blank(value)) continue;
        for (const text of Array.isArray(value) ? value : [value]) {
          if (cleanText(text)) incoming.push({ detail: String(text).trim() });
        }
        outcome.applied[field] = value;
        delete rest[field];
      }
    }
    if (incoming.length > 0) {
      const base = before.length > 0 ? before : legacyHighlights(section, target);
      const { merged, conflicts } = mergeHighlights(base, incoming);
      outcome.entryConflicts.push(...conflicts);
      if (JSON.stringify(merged) !== JSON.stringify(before)) {
        target.highlights = merged;
        outcome.applied.highlights = incoming;
        change("highlights", merged, before.length > 0 ? before : undefined);
      } else if (conflicts.length === 0) outcome.applied.highlights = incoming;
    }
  }
  if (section === "basics" && Array.isArray(rest.links)) {
    const before = Array.isArray(target.links) ? (target.links as Rec[]) : [];
    const merged = mergeLinks(before, rest.links as Rec[]);
    delete rest.links;
    if (JSON.stringify(merged) !== JSON.stringify(before)) {
      target.links = merged;
      outcome.applied.links = merged;
      change("links", merged, before.length > 0 ? before : undefined);
    }
  }
  for (const [field, raw] of Object.entries(rest)) {
    if (blank(raw)) continue;
    const incoming = cleanValue(raw);
    const existing = target[field];
    if (SOFT_FIELDS[section]?.includes(field) && !blank(existing)) continue;
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
    } else if (refines(existing, incoming)) {
      target[field] = incoming;
      outcome.applied[field] = incoming;
      outcome.changes.push({
        section,
        ...(itemId ? { itemId } : {}),
        field,
        value: incoming,
        previous: existing,
      });
    } else if (!sameValue(existing, incoming) && !refines(incoming, existing)) {
      const narrative =
        typeof existing === "string" &&
        typeof incoming === "string" &&
        NARRATIVE_FIELDS[section]?.includes(field)
          ? mergeNarrative(existing, incoming)
          : ({ kind: "conflict" } as const);
      if (narrative.kind === "set") {
        target[field] = narrative.value;
        outcome.applied[field] = incoming;
        outcome.changes.push({
          section,
          ...(itemId ? { itemId } : {}),
          field,
          value: narrative.value,
          previous: existing,
        });
      } else if (narrative.kind === "conflict") {
        outcome.conflicted[field] = incoming;
      }
    }
  }
  return outcome;
}

function missingFields(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => String(i.path[0] ?? "")))].filter(
    (f) => f && f !== "id" && f !== "sourceFactIds",
  );
}

export function draftMissing(draft: Draft): string[] {
  const checked = ITEM_SCHEMA[draft.section].safeParse(draft.item);
  return checked.success ? [] : missingFields(checked.error);
}

export function draftLabel(draft: Draft): string {
  return String(draft.item[ITEM_KEY[draft.section]] ?? "");
}

export function describeDrafted(d: Drafted): string {
  const fields = d.missing.map((f) => `${f}（${fieldLabel(d.section, f)}）`).join("、");
  return `「${d.label}」已暂存，还缺 ${fields}；问到后带上 ${ITEM_KEY[d.section]} 再写入即可补齐`;
}

export function applyFacts(
  profile: Profile,
  inputs: readonly FactInput[],
  context: ApplyContext,
): ApplyResult {
  const genId = context.genId ?? createIdGenerator();
  const next = structuredClone(profile);
  const drafts = structuredClone([...(context.drafts ?? [])]);
  const result: ApplyResult = {
    profile: next,
    facts: [],
    conflicts: [],
    rejected: [],
    dropped: [],
    changes: [],
    drafts,
    drafted: [],
  };

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
    const payload = { ...parsed.data };
    for (const d of dropUngrounded(section, payload, input.quote, context.userText))
      result.dropped.push({ ...d, index });
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
        const draft = drafts.find((d) => d.section === section && normKey(d.item[keyField]) === keyValue);
        const candidate: Rec = draft?.item ?? { id: genId(ID_PREFIX[section]), sourceFactIds: [] };
        itemId = String(candidate.id);
        candidate.sourceFactIds = union(candidate.sourceFactIds as unknown[], [factId]);
        outcome = mergeInto(candidate, payload, section, itemId);
        // 草稿还没进画像，用户改口直接以新说法为准
        for (const [field, value] of Object.entries(outcome.conflicted)) {
          candidate[field] = value;
          outcome.applied[field] = value;
        }
        outcome.conflicted = {};
        for (const c of outcome.entryConflicts) {
          const hit = (candidate.highlights as Highlight[]).find((h) => h.title === c.entry);
          if (hit) hit.detail = c.proposed;
        }
        outcome.entryConflicts = [];
        const checked = ITEM_SCHEMA[section].safeParse(candidate);
        if (checked.success) {
          if (draft) drafts.splice(drafts.indexOf(draft), 1);
          list.push(checked.data as Rec);
          outcome.changes = [{ section, itemId, field: "_item", value: checked.data }];
        } else {
          if (!draft) drafts.push({ section, item: candidate });
          result.drafted.push({
            section,
            label: String(candidate[keyField]),
            missing: missingFields(checked.error),
          });
          outcome.changes = [];
        }
      }
    }

    result.changes.push(...outcome.changes);
    const base = { section, quote: input.quote.trim(), sourceMessageId: context.messageId };
    const keyPayload = isList(section) ? { [ITEM_KEY[section]]: payload[ITEM_KEY[section]] } : {};
    const pendingCount = Object.keys(outcome.conflicted).length + outcome.entryConflicts.length;
    if (Object.keys(outcome.applied).length > 0 || pendingCount === 0) {
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
    for (const c of outcome.entryConflicts) {
      const pendingId = genId("fact");
      result.facts.push({
        id: pendingId,
        ...base,
        payload: { ...keyPayload, highlights: [{ title: c.entry, detail: c.proposed }] },
        status: "pending",
      });
      result.conflicts.push({
        factId: pendingId,
        section,
        ...(itemId ? { itemId } : {}),
        field: "highlights",
        entry: c.entry,
        label: `要点「${c.entry}」`,
        previous: c.previous,
        proposed: c.proposed,
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
    const entry = conflict.entry
      ? ((container?.highlights as Highlight[] | undefined) ?? []).find(
          (h) => h.title && normKey(h.title) === normKey(conflict.entry),
        )
      : undefined;
    if (container && conflict.entry) {
      if (entry) {
        const previous = structuredClone(container.highlights);
        entry.detail = String(conflict.proposed);
        container.sourceFactIds = union((container.sourceFactIds as unknown[]) ?? [], [conflict.factId]);
        changes.push({
          section: conflict.section,
          ...(conflict.itemId ? { itemId: conflict.itemId } : {}),
          field: "highlights",
          value: container.highlights,
          previous,
        });
      }
      if (pending) pending.status = entry ? "confirmed" : "superseded";
    } else if (container) {
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
