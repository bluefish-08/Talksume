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

function compareRecord(
  section: string,
  prefix: string,
  expected: Rec | undefined,
  predicted: Rec | undefined,
  out: UnitResult[],
) {
  const fields = new Set([...Object.keys(expected ?? {}), ...Object.keys(predicted ?? {})]);
  for (const field of fields) {
    if (IGNORED_FIELDS.has(field)) continue;
    compareField(section, `${prefix}.${field}`, expected?.[field], predicted?.[field], out);
  }
}

export function scoreProfile(predicted: Profile, expected: ExpectedProfile): UnitResult[] {
  const out: UnitResult[] = [];

  for (const section of OBJECT_SECTIONS) {
    compareRecord(
      section,
      section,
      expected[section] as Rec | undefined,
      predicted[section] as unknown as Rec,
      out,
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
        for (const [field, value] of Object.entries(e)) {
          if (!blank(value)) compareField(section, `${prefix}.${field}`, value, undefined, out);
        }
        continue;
      }
      const [p] = predictedItems.splice(at, 1);
      compareRecord(section, prefix, e, { ...p, [keyField]: e[keyField] }, out);
    }
    for (const p of predictedItems) {
      const prefix = `${section}[${String(p[keyField] ?? "")}]`;
      for (const [field, value] of Object.entries(p)) {
        if (!IGNORED_FIELDS.has(field)) compareField(section, `${prefix}.${field}`, undefined, value, out);
      }
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
