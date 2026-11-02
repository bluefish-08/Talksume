import type { Profile } from "@talksume/core";
import type { Contains, ExpectedProfile } from "./dataset.ts";

type Rec = Record<string, unknown>;

export interface UnitResult {
  section: string;
  /** 例如 projects[短链服务].result 或 intention.cities#杭州。 */
  key: string;
  status: "tp" | "fp" | "fn";
  expected?: string;
  predicted?: string;
}

export interface Metrics {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

const LIST_KEYS: Record<string, string> = {
  education: "school",
  experiences: "company",
  projects: "name",
  skills: "name",
  awards: "name",
};
const OBJECT_SECTIONS = ["basics", "intention"] as const;
const IGNORED_FIELDS = new Set(["id", "sourceFactIds"]);
/** 模型自己归的类，样例没写就不计分。 */
const UNLESS_EXPECTED = new Set(["category"]);
const NARRATIVE: Record<string, readonly string[]> = {
  experiences: ["bullets", "highlights"],
  projects: ["situation", "task", "action", "result", "highlights"],
};
export const NEW_FIELDS = [
  "techStack",
  "highlights",
  "gpa",
  "rank",
  "courses",
  "honors",
  "links",
  "category",
];

export function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function looseEqual(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.includes(short);
}

function blank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

function isContains(value: unknown): value is Contains {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "$contains" in value;
}

function show(value: unknown): string {
  if (isContains(value)) return `包含[${value.$contains.join("、")}]`;
  return Array.isArray(value) ? value.join("、") : String(value);
}

function compareField(
  section: string,
  key: string,
  expected: unknown,
  predicted: unknown,
  out: UnitResult[],
): void {
  const hasE = !blank(expected);
  const hasP = !blank(predicted);
  if (!hasE && !hasP) return;
  if (!hasE) {
    if (Array.isArray(predicted)) {
      for (const p of predicted)
        out.push({ section, key: `${key}#${norm(p)}`, status: "fp", predicted: String(p) });
    } else out.push({ section, key, status: "fp", predicted: show(predicted) });
    return;
  }
  if (!hasP) {
    if (Array.isArray(expected)) {
      for (const e of expected)
        out.push({ section, key: `${key}#${norm(e)}`, status: "fn", expected: String(e) });
    } else out.push({ section, key, status: "fn", expected: show(expected) });
    return;
  }

  if (Array.isArray(expected)) {
    const predictedList = (Array.isArray(predicted) ? predicted : [predicted]).map(String);
    const expectedList = expected.map(String);
    const used = new Set<number>();
    for (const e of expectedList) {
      const at = predictedList.findIndex((p, i) => !used.has(i) && looseEqual(e, p));
      if (at >= 0) {
        used.add(at);
        out.push({
          section,
          key: `${key}#${norm(e)}`,
          status: "tp",
          expected: e,
          predicted: predictedList[at] as string,
        });
      } else out.push({ section, key: `${key}#${norm(e)}`, status: "fn", expected: e });
    }
    predictedList.forEach((p, i) => {
      if (!used.has(i)) out.push({ section, key: `${key}#${norm(p)}`, status: "fp", predicted: p });
    });
    return;
  }

  const predictedText = Array.isArray(predicted) ? predicted.join("；") : String(predicted);
  const ok = isContains(expected)
    ? expected.$contains.every((k) => norm(predictedText).includes(norm(k)))
    : norm(expected) === norm(predictedText);
  if (ok) out.push({ section, key, status: "tp", expected: show(expected), predicted: predictedText });
  else {
    out.push({ section, key, status: "fp", expected: show(expected), predicted: predictedText });
    out.push({ section, key, status: "fn", expected: show(expected), predicted: predictedText });
  }
}

function textsOf(value: unknown): string[] {
  if (blank(value)) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => {
    if (v && typeof v === "object" && "detail" in v) {
      const h = v as { title?: string; detail: string };
      return h.title ? `${h.title}：${h.detail}` : h.detail;
    }
    return isContains(v) ? v.$contains.join(" ") : String(v);
  });
}

function bigrams(text: string): string[] {
  const plain = norm(text);
  return Array.from({ length: Math.max(0, plain.length - 1) }, (_, i) => plain.slice(i, i + 2));
}

/** 要点照原话写：数字都出自原话、文字大半能在原话里找到，就不算编造。 */
export function grounded(detail: string, corpus: string): boolean {
  const numbers = detail.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.some((n) => !corpus.includes(n))) return false;
  const grams = bigrams(detail);
  if (grams.length === 0) return true;
  return grams.filter((g) => corpus.includes(g)).length / grams.length >= 0.6;
}

function compareHighlights(
  section: string,
  prefix: string,
  expected: Rec,
  predicted: Rec,
  corpus: string | undefined,
  out: UnitResult[],
) {
  const fields = NARRATIVE[section] ?? [];
  const groups = fields.flatMap((f) =>
    ((Array.isArray(expected[f]) ? expected[f] : blank(expected[f]) ? [] : [expected[f]]) as unknown[]).map(
      (g) => (isContains(g) ? g.$contains : [String(g)]),
    ),
  );
  const pieces = fields.flatMap((f) =>
    textsOf(predicted[f]).map((text, i) => {
      const raw = Array.isArray(predicted[f]) ? (predicted[f] as unknown[])[i] : predicted[f];
      const detail = raw && typeof raw === "object" ? String((raw as { detail: unknown }).detail) : text;
      return { text, detail };
    }),
  );
  const used = new Set<number>();
  for (const words of groups) {
    const key = `${prefix}.highlights#${words.map(norm).join("+")}`;
    const at = pieces.findIndex((p) => words.every((w) => norm(p.text).includes(norm(w))));
    if (at >= 0) {
      used.add(at);
      out.push({
        section,
        key,
        status: "tp",
        expected: words.join("、"),
        predicted: pieces[at]?.text as string,
      });
    } else out.push({ section, key, status: "fn", expected: words.join("、") });
  }
  pieces.forEach((p, i) => {
    if (used.has(i)) return;
    if (corpus !== undefined && grounded(p.detail, corpus)) return;
    out.push({
      section,
      key: `${prefix}.highlights#${norm(p.text).slice(0, 12)}`,
      status: "fp",
      predicted: p.text,
    });
  });
}

function compareRecord(
  section: string,
  prefix: string,
  expected: Rec | undefined,
  predicted: Rec | undefined,
  out: UnitResult[],
  corpus?: string,
) {
  const narrative = NARRATIVE[section] ?? [];
  if (narrative.length > 0) compareHighlights(section, prefix, expected ?? {}, predicted ?? {}, corpus, out);
  const fields = new Set([...Object.keys(expected ?? {}), ...Object.keys(predicted ?? {})]);
  for (const field of fields) {
    if (IGNORED_FIELDS.has(field) || narrative.includes(field)) continue;
    if (UNLESS_EXPECTED.has(field) && blank(expected?.[field])) continue;
    let value = predicted?.[field];
    if (field === "links" && Array.isArray(value)) value = value.map((l) => String((l as Rec).url ?? ""));
    compareField(section, `${prefix}.${field}`, expected?.[field], value, out);
  }
}

/** userTurns 用来判断没对上的要点是否照原话写的；不传则一律计为误报。 */
export function scoreProfile(
  predicted: Profile,
  expected: ExpectedProfile,
  userTurns?: readonly string[],
): UnitResult[] {
  const out: UnitResult[] = [];
  const corpus = userTurns ? norm(userTurns.join("|")) : undefined;

  for (const section of OBJECT_SECTIONS) {
    compareRecord(
      section,
      section,
      expected[section] as Rec | undefined,
      predicted[section] as unknown as Rec,
      out,
      corpus,
    );
  }

  for (const [section, keyField] of Object.entries(LIST_KEYS)) {
    const expectedItems = ((expected as Rec)[section] as Rec[] | undefined) ?? [];
    const predictedItems = [...(((predicted as unknown as Rec)[section] as Rec[] | undefined) ?? [])];
    for (const e of expectedItems) {
      const eKey = String(e[keyField] ?? "");
      const at = predictedItems.findIndex((p) => looseEqual(eKey, String(p[keyField] ?? "")));
      const prefix = `${section}[${eKey}]`;
      if (at < 0) {
        compareRecord(section, prefix, e, {}, out);
        continue;
      }
      const [p] = predictedItems.splice(at, 1);
      compareRecord(section, prefix, e, { ...p, [keyField]: e[keyField] }, out, corpus);
    }
    for (const p of predictedItems) {
      const prefix = `${section}[${String(p[keyField] ?? "")}]`;
      compareRecord(section, prefix, undefined, p, out);
    }
  }
  return out;
}

export function summarize(units: readonly UnitResult[]): Metrics {
  const tp = units.filter((u) => u.status === "tp").length;
  const fp = units.filter((u) => u.status === "fp").length;
  const fn = units.filter((u) => u.status === "fn").length;
  const precision = tp + fp === 0 ? (fn === 0 ? 1 : 0) : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}

export function summarizeBySection(units: readonly UnitResult[]): Record<string, Metrics> {
  const sections = [...new Set(units.map((u) => u.section))];
  return Object.fromEntries(sections.map((s) => [s, summarize(units.filter((u) => u.section === s))]));
}
