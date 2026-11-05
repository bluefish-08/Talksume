import type { Fact, Profile } from "@talksume/core";
import type { ExpectedProfile } from "../dataset.ts";
import { norm, scoreProfile, summarize, type UnitResult } from "../metrics.ts";

const DEGREE: Record<string, RegExp> = {
  associate: /大专|专科|高职/,
  bachelor: /本科|大学生|大[一二三四]/,
  master: /硕士|研究生|研[一二三]/,
  phd: /博士/,
};
const JOB_TYPE: Record<string, RegExp> = {
  campus: /校招|应届/,
  internship: /实习/,
  experienced: /社招|跳槽/,
};
const KIND: Record<string, RegExp> = {
  internship: /实习/,
  parttime: /兼职|打工/,
  fulltime: /全职|正式/,
  campus: /学生会|社团|协会|志愿|宣传部|校园活动/,
};

function bigrams(s: string): string[] {
  return Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2));
}

/** 用户原话里有没有说过这个值：日期、学历、类别按常见说法匹配，其余按归一化包含或字对覆盖率 ≥0.75。 */
export function saidIn(raw: string, field: string, value: string): boolean {
  const date = value.match(/^(\d{4})-(\d{2})$/);
  if (date) {
    const [, y, m] = date as unknown as [string, string, string];
    const month = String(Number(m));
    const yy = `(?:${y}|${y.slice(2)})\\s*(?:年|[./-])\\s*`;
    return (
      new RegExp(`${yy}0?${month}(?!\\d)`).test(raw) ||
      new RegExp(`${yy}\\d{1,2}\\s*月?\\s*(?:到|至|-|~|—)\\s*0?${month}\\s*月`).test(raw)
    );
  }
  if (field === "degree" && DEGREE[value]) return DEGREE[value].test(raw);
  if (field === "jobType" && JOB_TYPE[value]) return JOB_TYPE[value].test(raw);
  if (field === "kind" && KIND[value]) return KIND[value].test(raw);
  const city = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 现居城市要有「人在 / 住在」这类说法；想去哪工作只算求职城市
  if (field === "city")
    return new RegExp(`(?:人在|住在|现在在|目前在|人就在|我在|家在|base\\s*在?)\\s*${city}`).test(raw);
  if (field === "cities") {
    // 「江城大学」「江城晨报」里的江城不算说过城市
    return new RegExp(`${city}(?:市|$|[^\\p{Script=Han}]|[的或和人找这那本附工上发就岗吧啊呢])`, "u").test(
      raw,
    );
  }
  const corpus = norm(raw);
  const v = norm(value);
  if (!v) return false;
  if (corpus.includes(v)) return true;
  const grams = bigrams(v);
  return grams.length >= 3 && grams.filter((g) => corpus.includes(g)).length / grams.length >= 0.75;
}

function unitWords(u: UnitResult): string[] {
  const e = u.expected ?? "";
  const inner = e.match(/^包含\[(.*)\]$/)?.[1];
  if (inner !== undefined) return inner.split("、");
  if (u.key.includes(".highlights#")) return e.split("、");
  return [e];
}

function fieldOf(key: string): string {
  return (key.split("#")[0] ?? key).split(".").at(-1) ?? "";
}

export interface RecallUnit {
  key: string;
  expected: string;
  said: boolean;
  recorded: boolean;
}

/** 召回只看用户说过的：标准答案里每一项，用户原话里出现了才进分母。 */
export function recallUnits(units: readonly UnitResult[], userTexts: readonly string[]): RecallUnit[] {
  const raw = userTexts.join("\n");
  const expected = units.filter((u) => u.status === "tp" || u.status === "fn");
  return expected.map((u) => ({
    key: u.key,
    expected: u.expected ?? "",
    said: unitWords(u).every((w) => saidIn(raw, fieldOf(u.key), w)),
    recorded: u.status === "tp",
  }));
}

type Item = Record<string, unknown> & { id: string; sourceFactIds?: string[] };
const CONTENT_IGNORED = new Set(["id", "sourceFactIds", "kind", "name", "company"]);
const blank = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** 实习/项目条目里除了名字（和类别）什么都没有。 */
export function emptyItems(profile: Profile): string[] {
  const items = [...profile.experiences, ...profile.projects] as unknown as Item[];
  return items
    .filter((it) => Object.entries(it).every(([k, v]) => CONTENT_IGNORED.has(k) || blank(v)))
    .map((it) => String(it.name ?? it.company));
}

function similarName(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const gx = new Set(bigrams(x));
  const gy = new Set(bigrams(y));
  const hit = [...gx].filter((g) => gy.has(g)).length;
  return hit / Math.max(1, Math.min(gx.size, gy.size)) >= 0.5;
}

/** 疑似重复的条目对：名字互相包含或字对覆盖率 ≥0.5，或者引用了同一句原话。 */
export function duplicatePairs(profile: Profile, facts: readonly Fact[]): string[] {
  const quoteOf = new Map(facts.map((f) => [f.id, norm(f.quote)]));
  const items = [...profile.experiences, ...profile.projects] as unknown as Item[];
  const label = (it: Item) => String(it.name ?? it.company);
  const quotes = (it: Item) => new Set((it.sourceFactIds ?? []).map((id) => quoteOf.get(id)).filter(Boolean));
  const pairs: string[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i] as Item;
      const b = items[j] as Item;
      const qa = quotes(a);
      const shared = [...quotes(b)].some((q) => qa.has(q));
      if (similarName(label(a), label(b)) || shared) pairs.push(`${label(a)} ~ ${label(b)}`);
    }
  }
  return pairs;
}

export function accuracy(profile: Profile, expected: ExpectedProfile, userTexts: readonly string[]) {
  const units = scoreProfile(profile, expected, userTexts);
  const corpus = norm(userTexts.join("|"));
  const highlights = [...profile.experiences, ...profile.projects].flatMap((e) =>
    ((e as { highlights?: { detail: string }[] }).highlights ?? []).map((h) => h.detail),
  );
  const ungroundedNums = highlights.flatMap((d) =>
    (d.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !corpus.includes(n)),
  );
  const raw = userTexts.join("\n");
  const unfounded = units.filter(
    (u) => u.status === "fp" && !(u.predicted !== undefined && saidIn(raw, fieldOf(u.key), u.predicted)),
  );
  return { units, metrics: summarize(units), ungroundedNums, unfounded };
}
