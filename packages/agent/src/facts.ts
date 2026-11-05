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
import { requiredMissing, SECTION_BY_NAME } from "./completeness.ts";
import {
  type Candidate,
  hasContent,
  isPlaceholder,
  placeholderQuestion,
  resolveIdentity,
} from "./identity.ts";
import { type FactInput, formatZodIssues, SectionPayload } from "./schemas.ts";
import { resumeWording, wordingProblems } from "./wording.ts";

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
  /** 已有的事实，用来认出条目改名前的叫法。 */
  facts?: readonly Fact[];
}

/** 还不能进简历的新条目：只有泛称（占位），或者除了名字什么都没有。 */
export interface Draft {
  section: ListSection;
  item: Rec;
}

export interface Drafted {
  section: ListSection;
  label: string;
  missing: string[];
  /** 只有泛称，等用户说出具体名称。 */
  placeholder?: boolean;
}

export interface ApplyResult {
  profile: Profile;
  /** 本次新增的事实记录：已写入的为 confirmed，与旧值矛盾的为 pending。 */
  facts: Fact[];
  conflicts: Conflict[];
  rejected: RejectedFact[];
  /** 原话里找不到依据、被丢掉的推测字段；事实本身照常写入。 */
  dropped: DroppedField[];
  /** 要点的简历写法没通过校验、已退回用户原话。 */
  reverted: DroppedField[];
  changes: ProfileChange[];
  drafts: Draft[];
  drafted: Drafted[];
  /** 和已记录内容完全一样、没有写入的事实下标。 */
  unchanged: number[];
}

export const LEVEL_WORDS = {
  beginner: ["了解", "入门", "初学"],
  familiar: ["熟悉"],
  proficient: ["熟练", "擅长"],
  expert: ["精通"],
} as const satisfies Record<NonNullable<Skill["level"]>, readonly string[]>;

const DATE_LIKE = /\d{2,4}\s*[年.\-/]|\d{4}|[〇零一二三四五六七八九]{2,4}年|[去今前]年|\d{1,2}\s*月/;

const plainText = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");

const CN_MONTHS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

/** 年份要在原话里写明；实习和项目的月份也要写明，教育按约定只知道年份时月份记 09。 */
function dateGrounded(value: string, quote: string, checkMonth: boolean): boolean {
  const [year = "", month = ""] = value.split("-");
  const text = quote.replace(/\s+/g, "");
  if (!(text.includes(year) || new RegExp(`(?<!\\d)${year.slice(2)}年`).test(text))) return false;
  if (!checkMonth) return true;
  const m = Number(month);
  return new RegExp(`(?<!\\d)0?${m}月|${year}[.\\-/]0?${m}(?!\\d)|(?<!十)${CN_MONTHS[m]}月`).test(text);
}

const DATED_SECTIONS: Partial<Record<ProfileSection, boolean>> = {
  education: false,
  experiences: true,
  projects: true,
};

const NEGATION =
  /没(?:有)?(?:怎么)?(?:用|学|接触|碰|做|写|听说|了解)过|没(?:用|学|接触|碰)|不会|不懂|不熟|不了解|从没|从来没/;
const EXCEPT = /除了|以外|之外|别的|其他|其它/;

/** 原话是在说没用过、不会这项（「Git 没用过」），不能记成技能或技术栈。 */
export function negatedIn(quote: string, name: string): boolean {
  const target = name.toLowerCase().replace(/\s+/g, "");
  if (!target) return false;
  return quote.split(/[，,。；;！!？?\n…]/).some((clause) => {
    const flat = clause.toLowerCase().replace(/\s+/g, "");
    const at = flat.indexOf(target);
    return at >= 0 && !EXCEPT.test(flat) && NEGATION.test(flat.slice(at + target.length));
  });
}

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
  for (const [field, own] of [
    ["date", section === "awards"],
    ["availableFrom", section === "intention"],
  ] as const) {
    const value = payload[field];
    if (!own || typeof value !== "string" || dateGrounded(value, quote, true)) continue;
    dropped.push({ field, reason: `原话里没有写明 ${value} 这个年月，不要推算` });
    delete payload[field];
  }
  if (
    typeof payload.city === "string" &&
    !plainText(`${quote}|${userText}`).includes(plainText(payload.city))
  ) {
    dropped.push({ field: "city", reason: `用户没说过「${payload.city}」，不要按学校或公司推断城市` });
    delete payload.city;
  }
  const checkMonth = DATED_SECTIONS[section];
  if (checkMonth !== undefined) {
    for (const field of ["start", "end"]) {
      const value = payload[field];
      if (typeof value !== "string" || value === "present" || dateGrounded(value, quote, checkMonth))
        continue;
      dropped.push({ field, reason: `原话里没有写明 ${value} 这个年月，不要推算` });
      delete payload[field];
    }
  }
  if (Array.isArray(payload.techStack)) {
    const negated = (payload.techStack as string[]).filter((t) => negatedIn(quote, t));
    if (negated.length > 0) {
      dropped.push({ field: "techStack", reason: `原话说的是没用过「${negated.join("、")}」` });
      payload.techStack = (payload.techStack as string[]).filter((t) => !negated.includes(t));
    }
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

const MIN_FALLBACK = 6;

/** 要点 detail 用模型写的简历用语，校验不过退回原话；标题和角色里有拔高说法就去掉。 */
function checkWording(payload: Rec, quote: string, userText = ""): Omit<DroppedField, "index">[] {
  const source = `${quote}\n${userText}`;
  const original = quote.split(/…+|\.{3,}/).join("，");
  const reverted: Omit<DroppedField, "index">[] = [];
  const labelProblems = (text: string) => wordingProblems(text, source, true);
  // 「做过」这类确认退回原话没有意义，不合格就整条去掉
  const bare = original.replace(/[\s\p{P}\p{S}]/gu, "").length < MIN_FALLBACK;
  if (Array.isArray(payload.highlights)) {
    payload.highlights = (payload.highlights as Highlight[]).filter((h) => {
      const worded = resumeWording(h.detail, original, source, String(payload.name ?? payload.company ?? ""));
      if (worded.problems.length > 0) {
        const what = `要点「${h.title ?? h.detail.slice(0, 10)}」的写法里有「${worded.problems.join("、")}」`;
        reverted.push({ field: "highlights", reason: `${what}，${bare ? "已去掉" : "已退回原话"}` });
        if (bare) return false;
      }
      h.detail = worded.text;
      if (h.title && labelProblems(h.title).length > 0) {
        reverted.push({ field: "highlights", reason: `要点标题「${h.title}」超出原话，已去掉` });
        delete h.title;
      }
      return true;
    });
  }
  if (typeof payload.role === "string" && labelProblems(payload.role).length > 0) {
    reverted.push({
      field: "role",
      reason: `角色「${payload.role}」里有原话没说的「${labelProblems(payload.role).join("、")}」，已去掉`,
    });
    delete payload.role;
  }
  return reverted;
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

export function bigrams(text: string): Set<string> {
  const plain = text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  const out = new Set<string>();
  for (let i = 0; i < plain.length - 1; i++) out.add(plain.slice(i, i + 2));
  return out;
}

export function coverage(of: Set<string>, within: Set<string>): number {
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
    if (restates(merged, title, detail)) continue;
    merged.push(title ? { title, detail } : { detail });
  }
  return { merged, conflicts };
}

const SAME_THING = 0.6;
const RESTATED = 0.8;

/**
 * 用户复述老内容时别追加重复的一条：和某条无标题要点讲的是同一件事，就给它补上标题
 * （新说法基本覆盖旧原文时换成新说法）；已被某条带标题要点覆盖的，直接略过。
 */
function restates(merged: Highlight[], title: string | undefined, detail: string): boolean {
  const grams = bigrams(detail);
  const newNumbers = [...anchorsOf(detail)].filter((x) => /^\d/.test(x));
  for (const h of merged) {
    const old = bigrams(h.detail);
    const covered = coverage(grams, old);
    const covers = coverage(old, grams);
    const addsNumbers = newNumbers.some((n) => !anchorsOf(h.detail).has(n));
    if (h.title && title) {
      if (covered >= RESTATED && !addsNumbers) return true;
      continue;
    }
    if (!h.title && Math.max(covered, covers) >= SAME_THING) {
      if ((covers >= RESTATED && covers >= covered) || (addsNumbers && covers >= SAME_THING))
        h.detail = detail;
      else if (addsNumbers) continue;
      if (title) h.title = title;
      return true;
    }
  }
  return false;
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

interface Admission {
  parsed?: Rec;
  /** 占位时只有名称一项；否则是 completeness 的必填缺项加上 schema 的缺项。 */
  missing: string[];
  placeholder: boolean;
}

/** 进画像的门槛：schema 合法、不是只有泛称、不是除了名字什么都没有。 */
function admission(section: ListSection, item: Rec): Admission {
  const key = ITEM_KEY[section];
  if (isPlaceholder(section, item)) return { missing: [key], placeholder: true };
  const checked = ITEM_SCHEMA[section].safeParse(item);
  const required = requiredMissing(section, item);
  const missing = [...new Set([...(checked.success ? [] : missingFields(checked.error)), ...required])];
  const ok = checked.success && (required.length === 0 || hasContent(item, key));
  return { ...(ok ? { parsed: checked.data as Rec } : {}), missing, placeholder: false };
}

export function draftMissing(draft: Draft): string[] {
  return admission(draft.section, draft.item).missing;
}

export function isPlaceholderDraft(draft: Draft): boolean {
  return isPlaceholder(draft.section, draft.item);
}

export function draftLabel(draft: Draft): string {
  return String(draft.item[ITEM_KEY[draft.section]] ?? "");
}

export function draftQuestion(draft: Draft): string | undefined {
  return isPlaceholderDraft(draft) ? placeholderQuestion(draft.section, draftLabel(draft)) : undefined;
}

export function describeDrafted(d: Drafted): string {
  const key = ITEM_KEY[d.section];
  if (d.placeholder) {
    return `「${d.label}」只是泛称，已暂存为占位，不进简历；先问清具体做的是什么、叫什么，不要问角色、技术栈等细节。用户说出名称后，用具体名称写 ${key}，系统会并进这一条，不要另起一条，也不要再用泛称写`;
  }
  const fields = d.missing.map((f) => `${f}（${fieldLabel(d.section, f)}）`).join("、");
  return `「${d.label}」已暂存，还缺 ${fields}；问到后带上 ${key} 再写入即可补齐`;
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
    reverted: [],
    changes: [],
    drafts,
    drafted: [],
    unchanged: [],
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
    if (section === "skills" && negatedIn(input.quote, String(payload.name ?? ""))) {
      reject(`原话「${input.quote}」说的是没用过/不会「${String(payload.name)}」，不能记成技能`);
      continue;
    }
    for (const d of dropUngrounded(section, payload, input.quote, context.userText))
      result.dropped.push({ ...d, index });
    if (section === "experiences" || section === "projects") {
      for (const d of checkWording(payload, input.quote, context.userText))
        result.reverted.push({ ...d, index });
    }
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
      const known = new Map(
        [...(context.facts ?? []), ...result.facts].map((f) => [f.id, f.payload[keyField]]),
      );
      const aliases = (item: Rec) =>
        ((item.sourceFactIds as string[] | undefined) ?? []).flatMap((id) => {
          const name = known.get(id);
          return typeof name === "string" ? [name] : [];
        });
      const pool: Candidate[] = [
        ...list.map((item) => ({ item, draft: false })),
        ...drafts.filter((d) => d.section === section).map((d) => ({ item: d.item, draft: true })),
      ];
      const hit = resolveIdentity(
        section,
        String(payload[keyField]).trim(),
        payload,
        input.quote,
        pool,
        aliases,
      );
      const { [keyField]: _key, ...rest } = payload;
      const rename = (target: Rec, id: string) => {
        if (!hit?.rename || sameValue(target[keyField], hit.rename)) return;
        const previous = target[keyField];
        target[keyField] = hit.rename;
        outcome.applied[keyField] = hit.rename;
        outcome.changes.push({ section, itemId: id, field: keyField, value: hit.rename, previous });
      };
      if (hit && !hit.draft) {
        const existing = hit.item;
        itemId = String(existing.id);
        outcome = mergeInto(existing, rest, section, itemId);
        rename(existing, itemId);
        if (Object.keys(outcome.applied).length > 0) {
          existing.sourceFactIds = union(existing.sourceFactIds as unknown[], [factId]);
        }
      } else {
        const draft = hit ? drafts.find((d) => d.item === hit.item) : undefined;
        const candidate: Rec = draft?.item ?? { id: genId(ID_PREFIX[section]), sourceFactIds: [] };
        itemId = String(candidate.id);
        candidate.sourceFactIds = union(candidate.sourceFactIds as unknown[], [factId]);
        outcome = mergeInto(candidate, draft ? rest : payload, section, itemId);
        if (draft) rename(candidate, itemId);
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
        const admitted = admission(section, candidate);
        if (admitted.parsed) {
          if (draft) drafts.splice(drafts.indexOf(draft), 1);
          list.push(admitted.parsed);
          outcome.changes = [{ section, itemId, field: "_item", value: admitted.parsed }];
        } else {
          if (!draft) drafts.push({ section, item: candidate });
          result.drafted.push({
            section,
            label: String(candidate[keyField]),
            missing: admitted.missing,
            ...(admitted.placeholder ? { placeholder: true } : {}),
          });
          outcome.changes = [];
        }
      }
    }

    result.changes.push(...outcome.changes);
    const base = { section, quote: input.quote.trim(), sourceMessageId: context.messageId };
    const keyPayload = isList(section) ? { [ITEM_KEY[section]]: payload[ITEM_KEY[section]] } : {};
    const pendingCount = Object.keys(outcome.conflicted).length + outcome.entryConflicts.length;
    if (Object.keys(outcome.applied).length === 0 && pendingCount === 0) result.unchanged.push(index);
    if (Object.keys(outcome.applied).length > 0) {
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
