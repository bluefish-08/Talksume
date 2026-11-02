import type { ResumeContent, ResumeSection } from "./resume.ts";

export const POLISHABLE_KINDS = [
  "experiences",
  "projects",
  "awards",
] as const satisfies readonly ResumeSection["kind"][];

/** 一条可润色的要点；itemKey + sourceHash 定位，原文一变哈希就变，旧润色自然不再命中。 */
export interface PolishTarget {
  itemKey: string;
  sectionKind: ResumeSection["kind"];
  heading: string;
  subheading?: string;
  slot: number;
  text: string;
  sourceHash: string;
  factIds: string[];
}

export interface AcceptedPolish {
  itemKey: string;
  sourceHash: string;
  text: string;
}

/** FNV-1a 64 位（按 UTF-16 码元）；只用来判断原文是否变化，web 端也要算，所以不用 node:crypto。 */
export function polishSourceHash(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const trimmed = text.trim();
  for (let i = 0; i < trimmed.length; i++) {
    hash ^= BigInt(trimmed.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export function polishItemKey(kind: ResumeSection["kind"], heading: string): string {
  return `${kind}:${heading.trim()}`;
}

export function polishTargets(resume: ResumeContent): PolishTarget[] {
  const kinds: readonly string[] = POLISHABLE_KINDS;
  return resume.sections
    .filter((section) => kinds.includes(section.kind))
    .flatMap((section) =>
      section.items.flatMap((item) =>
        item.bullets.map((bullet, slot) => ({
          itemKey: polishItemKey(section.kind, item.heading),
          sectionKind: section.kind,
          heading: item.heading,
          ...(item.subheading && { subheading: item.subheading }),
          slot,
          text: bullet.text,
          sourceHash: polishSourceHash(bullet.text),
          factIds: [...bullet.factIds],
        })),
      ),
    );
}

/** 只替换文字，factIds 原样保留；原文已变的润色找不到对应哈希，回退原文。 */
export function applyPolish(resume: ResumeContent, accepted: readonly AcceptedPolish[]): ResumeContent {
  if (accepted.length === 0) return resume;
  const byKey = new Map(accepted.map((p) => [`${p.itemKey}#${p.sourceHash}`, p.text]));
  const kinds: readonly string[] = POLISHABLE_KINDS;
  return {
    ...resume,
    sections: resume.sections.map((section) =>
      kinds.includes(section.kind)
        ? {
            ...section,
            items: section.items.map((item) => {
              const itemKey = polishItemKey(section.kind, item.heading);
              return {
                ...item,
                bullets: item.bullets.map((bullet) => {
                  const text = byKey.get(`${itemKey}#${polishSourceHash(bullet.text)}`)?.trim();
                  return text ? { ...bullet, text } : bullet;
                }),
              };
            }),
          }
        : section,
    ),
  };
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10_000 };

function parseChineseNumber(raw: string): number | undefined {
  let total = 0;
  let section = 0;
  let digit: number | undefined;
  for (const ch of raw) {
    if (ch in CN_DIGITS) {
      digit = CN_DIGITS[ch];
    } else if (ch === "万") {
      total = (total + section + (digit ?? 0)) * 10_000;
      section = 0;
      digit = undefined;
    } else if (ch in CN_UNITS) {
      section += (digit ?? 1) * (CN_UNITS[ch] ?? 1);
      digit = undefined;
    } else {
      return undefined;
    }
  }
  const value = total + section + (digit ?? 0);
  return Number.isFinite(value) ? value : undefined;
}

function normalizeNumber(raw: string): string {
  const n = Number(raw.replaceAll(",", ""));
  return Number.isFinite(n) ? String(n) : raw;
}

// 紧跟字母的数字归属于技术词（Vue3、P99），由词校验负责
const NUMBER = /(?<![A-Za-z])\d[\d,]*(?:\.\d+)?/g;

function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(NUMBER)) found.add(normalizeNumber(m[0]));
  for (const m of text.matchAll(/[零〇一二两三四五六七八九十百千万]+/g)) {
    const value = parseChineseNumber(m[0]);
    if (value !== undefined) found.add(String(value));
  }
  return found;
}

const LATIN_TOKEN = /[A-Za-z][A-Za-z0-9]*(?:[.+#-][A-Za-z0-9+#]+)*[+#]*/g;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 润色结果里出现、原文里没有的数字和英文词，非空即判不合格。
 * 中文专有名词无法程序化识别，只能靠提示词约束。
 */
export function ungroundedTokens(source: string, polished: string): string[] {
  const sourceNumbers = numbersIn(source);
  const lowerSource = source.toLowerCase();
  const problems = new Set<string>();
  for (const m of polished.matchAll(NUMBER)) {
    if (!sourceNumbers.has(normalizeNumber(m[0]))) problems.add(m[0]);
  }
  for (const m of polished.matchAll(LATIN_TOKEN)) {
    const token = m[0].toLowerCase();
    const bounded = new RegExp(`(?<![a-z])${escapeRegExp(token)}(?![a-z])`);
    if (!bounded.test(lowerSource)) problems.add(m[0]);
  }
  return [...problems];
}
