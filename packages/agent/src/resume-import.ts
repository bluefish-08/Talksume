import type { ProfileSection } from "@talksume/core";
import { computeCompleteness, SECTION_BY_NAME, type Slot } from "./completeness.ts";
import { type ApplyResult, applyFacts, ungroundedNumbers } from "./facts.ts";
import { liftSkips } from "./memory.ts";
import { FactInput } from "./schemas.ts";
import { nextSlotOf, normalizeQuote, noteAsked, quoteInCorpus } from "./tools.ts";
import type { IntakeState, TurnMeta } from "./types.ts";

type Rec = Record<string, unknown>;

/** 导入消息作为用户发言回放给模型，开头说明来历，免得模型当成用户刚说的话逐条追问。 */
export const RESUME_MESSAGE_PREFIX = "[我导入了已有简历，以下是简历原文，其中的信息已写入画像]\n";

export interface ImportDrop {
  section: ProfileSection;
  label: string;
  /** 只丢了某个字段时填字段名；整条事实被丢弃时为空。 */
  field?: string;
  reason: string;
}

export interface ImportCheck {
  facts: FactInput[];
  dropped: ImportDrop[];
}

const KEY_FIELD: Partial<Record<ProfileSection, string>> = {
  education: "school",
  experiences: "company",
  projects: "name",
  skills: "name",
  awards: "name",
};

/** 模型按原文归的类或格式化后的值，不要求逐字出现。 */
const CLASSIFIED = new Set(["kind", "jobType", "category", "level", "showSalary"]);
const DATE_FIELDS = new Set(["start", "end", "date", "availableFrom"]);
const DEGREE_WORDS: Record<string, RegExp> = {
  associate: /专科|大专|高职/,
  bachelor: /本科|学士|\bbachelor|\bb\.?sc?\b/i,
  master: /硕士|研究生|\bmaster|\bm\.?sc?\b|\bmba\b/i,
  phd: /博士|\bph\.?d/i,
};
/** 超过这个长度的文字视为叙述，允许模型去掉连接词，但字词要大体出自原文。 */
const SHORT_TEXT = 30;
const NARRATIVE_COVERAGE = 0.7;

function bigrams(plain: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < plain.length - 1; i++) out.push(plain.slice(i, i + 2));
  return out;
}

function covered(value: string, corpus: string): number {
  const grams = bigrams(normalizeQuote(value));
  if (grams.length === 0) return 1;
  return grams.filter((g) => corpus.includes(g)).length / grams.length;
}

export function labelOfFact(section: ProfileSection, payload: Rec): string {
  const key = KEY_FIELD[section];
  if (key && typeof payload[key] === "string") return payload[key] as string;
  if (section === "basics") return typeof payload.name === "string" ? payload.name : "基本信息";
  if (section === "intention" && Array.isArray(payload.roles) && payload.roles.length > 0)
    return String(payload.roles[0]);
  return SECTION_BY_NAME[section].label;
}

/** 返回原文里找不到依据的原因；undefined 表示通过。 */
function ungroundedText(value: string, text: string, corpus: string): string | undefined {
  const numbers = ungroundedNumbers(value, text);
  if (numbers.length > 0) return `数字 ${numbers.join("、")} 在原文里找不到`;
  const plain = normalizeQuote(value);
  if (!plain) return undefined;
  if (value.length <= SHORT_TEXT) return corpus.includes(plain) ? undefined : `「${value}」在原文里找不到`;
  return covered(value, corpus) >= NARRATIVE_COVERAGE ? undefined : "和原文对不上，像是改写或补充的内容";
}

function checkField(field: string, value: unknown, text: string, corpus: string): string | undefined {
  if (CLASSIFIED.has(field)) return field === "showSalary" ? "简历原文不涉及是否展示薪资" : undefined;
  if (DATE_FIELDS.has(field)) {
    if (value === "present") return /至今|今|present|now/i.test(text) ? undefined : "原文没有写「至今」";
    const year = String(value).slice(0, 4);
    return text.includes(year) ? undefined : `年份 ${year} 在原文里找不到`;
  }
  if (field === "degree") {
    return DEGREE_WORDS[String(value)]?.test(text) ? undefined : "原文没有写学历层次";
  }
  if (typeof value === "number") {
    return ungroundedNumbers(String(value), text).length === 0 ? undefined : `数字 ${value} 在原文里找不到`;
  }
  if (typeof value === "string") return ungroundedText(value, text, corpus);
  return undefined;
}

function groundPayload(payload: Rec, text: string, corpus: string) {
  const dropped: { field: string; reason: string }[] = [];
  for (const [field, value] of Object.entries(payload)) {
    if (field === "highlights" && Array.isArray(value)) {
      payload.highlights = value.filter((h: { title?: string; detail: string }) => {
        const reason =
          ungroundedText(h.detail, text, corpus) ??
          (h.title && ungroundedNumbers(h.title, text).length > 0 ? "标题里的数字在原文里找不到" : undefined);
        if (reason) dropped.push({ field, reason: `要点「${h.title ?? h.detail.slice(0, 12)}」${reason}` });
        return !reason;
      });
      if ((payload.highlights as unknown[]).length === 0) delete payload.highlights;
      continue;
    }
    if (field === "links" && Array.isArray(value)) {
      payload.links = value.filter((l: { url: string }) => {
        const ok = corpus.includes(normalizeQuote(l.url.replace(/^https?:\/\//, "")));
        if (!ok) dropped.push({ field, reason: `链接 ${l.url} 在原文里找不到` });
        return ok;
      });
      if ((payload.links as unknown[]).length === 0) delete payload.links;
      continue;
    }
    if (Array.isArray(value)) {
      const kept = value.filter((v) => {
        const reason = typeof v === "string" ? ungroundedText(v, text, corpus) : undefined;
        if (reason) dropped.push({ field, reason });
        return !reason;
      });
      if (kept.length > 0) payload[field] = kept;
      else delete payload[field];
      continue;
    }
    const reason = checkField(field, value, text, corpus);
    if (reason) {
      dropped.push({ field, reason });
      delete payload[field];
    }
  }
  return dropped;
}

/**
 * 简历导入的防编造核对：quote 必须能在原文里逐字找到，否则整条丢弃；
 * payload 里的名称、数字、日期也要出自原文，找不到的字段单独丢弃。
 */
export function verifyImportFacts(text: string, inputs: readonly unknown[]): ImportCheck {
  const corpus = normalizeQuote(text);
  const out: ImportCheck = { facts: [], dropped: [] };
  for (const raw of inputs) {
    const parsed = FactInput.safeParse(raw);
    const rawSection = (raw as { section?: unknown })?.section;
    if (!parsed.success) {
      const section = (
        typeof rawSection === "string" && rawSection in SECTION_BY_NAME ? rawSection : "basics"
      ) as ProfileSection;
      out.dropped.push({ section, label: SECTION_BY_NAME[section].label, reason: "格式不合法" });
      continue;
    }
    const fact = structuredClone(parsed.data);
    const payload = fact.payload as Rec;
    const label = labelOfFact(fact.section, payload);
    if (normalizeQuote(fact.quote).length < 2 || !quoteInCorpus(corpus, fact.quote)) {
      out.dropped.push({
        section: fact.section,
        label,
        reason: `原文里找不到「${fact.quote.slice(0, 30)}」`,
      });
      continue;
    }
    const fieldDrops = groundPayload(payload, text, corpus);
    const key = KEY_FIELD[fact.section];
    if (key && fieldDrops.some((d) => d.field === key)) {
      out.dropped.push({
        section: fact.section,
        label,
        reason: fieldDrops.find((d) => d.field === key)?.reason ?? "",
      });
      continue;
    }
    for (const d of fieldDrops) out.dropped.push({ section: fact.section, label, ...d });
    if (Object.keys(payload).length > 0) out.facts.push(fact);
  }
  return out;
}

export interface ImportGroup {
  section: ProfileSection;
  label: string;
  items: string[];
}

export function groupImportFacts(facts: readonly FactInput[]): ImportGroup[] {
  const groups: ImportGroup[] = [];
  for (const fact of facts) {
    let group = groups.find((g) => g.section === fact.section);
    if (!group) {
      group = { section: fact.section, label: SECTION_BY_NAME[fact.section].label, items: [] };
      groups.push(group);
    }
    const label = labelOfFact(fact.section, fact.payload as Rec);
    if (!group.items.includes(label)) group.items.push(label);
  }
  const order = Object.keys(SECTION_BY_NAME);
  return groups.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
}

export function describeImportGroups(groups: readonly ImportGroup[]): string {
  return groups
    .map((g) => {
      if (g.section === "basics" || g.section === "intention") return g.label;
      if (g.section === "skills") return `技能 ${g.items.length} 项`;
      const names = g.items
        .slice(0, 3)
        .map((n) => `「${n}」`)
        .join("");
      return `${g.label}${names}${g.items.length > 3 ? ` 等 ${g.items.length} 条` : ""}`;
    })
    .join("、");
}

export function applyImport(
  state: IntakeState,
  input: { messageId: string; text: string; facts: readonly FactInput[]; genId: (prefix: string) => string },
): ApplyResult {
  const result = applyFacts(state.profile, input.facts, {
    messageId: input.messageId,
    genId: input.genId,
    drafts: state.drafts,
    userText: input.text,
  });
  state.profile = result.profile;
  state.drafts = result.drafts;
  state.facts.push(...result.facts);
  liftSkips(state, result.changes);
  state.conflicts.push(...result.conflicts);
  return result;
}

function askAbout(slot: Slot): string {
  if (slot.kind === "new_item") return `简历里还没有${SECTION_BY_NAME[slot.section].label}。${slot.question}`;
  const where = slot.itemLabel ? `「${slot.itemLabel}」` : "";
  return `简历里${where}没写${slot.label}，${slot.question}`;
}

export function importOpening(
  state: IntakeState,
  result: ApplyResult,
  facts: readonly FactInput[],
): { text: string; meta: TurnMeta } {
  const groups = groupImportFacts(facts);
  const read = groups.length > 0 ? `：${describeImportGroups(groups)}` : "";
  const lines = [`我从你的简历里读到了 ${facts.length} 条信息${read}。`];
  const meta: TurnMeta = { changes: result.changes };
  const first = state.conflicts[0];
  if (first) {
    const ask = `简历里写的${first.label}是「${String(first.proposed)}」，之前记录的是「${String(first.previous)}」，以哪个为准？`;
    lines.push(`其中 ${state.conflicts.length} 处和之前记录的不一样，先确认一下：${ask}`);
    return { text: lines.join("\n"), meta };
  }
  const slot = nextSlotOf(state);
  noteAsked(state, slot);
  if (!slot) {
    lines.push("简历内容已经比较完整了。想再补充点什么，还是看看适合你的岗位？");
    return { text: lines.join("\n"), meta };
  }
  const { missing } = computeCompleteness(state.profile, { completedSections: state.completedSections });
  const gaps = missing.filter((m) => m.required).length;
  lines.push(
    gaps > 1
      ? `已经有的内容我不会再问，接下来只补简历里没写的 ${gaps} 处。先从这个开始：${askAbout(slot)}`
      : `已经有的内容我不会再问。${askAbout(slot)}`,
  );
  return {
    text: lines.join("\n"),
    meta: { ...meta, slot: slot.key, ...(slot.replies ? { quickReplies: slot.replies } : {}) },
  };
}
