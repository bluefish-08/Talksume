import type { TailorLevel } from "@talksume/core";
import { findSkills, normalizeSkillList, PARTIAL_COVERAGE } from "@talksume/matching";

interface LevelRule {
  summary: boolean;
  maxRewrites: number;
  /** 新措辞里的字符至少有这个比例来自原文，越低越允许重写。 */
  minOverlap: number;
  /** 改写里出现原文没有的技能名：light 一律不行，其余只允许原文已有技能的上位或相近说法。 */
  coveredSkills: boolean;
  guidance: string;
}

export const LEVEL_RULES: Record<TailorLevel, LevelRule> = {
  light: {
    summary: false,
    maxRewrites: 4,
    minOverlap: 0.8,
    coveredSkills: false,
    guidance:
      "本次档位：微调。顺序调整为主；rewrites 只做小幅措辞调整（把相关内容提到句首、删去口语赘词），不要引入任何岗位描述里的技能词或说法，不要写 summary（给 null）。",
  },
  keywords: {
    summary: true,
    maxRewrites: 6,
    minOverlap: 0.6,
    coveredSkills: true,
    guidance:
      "本次档位：嵌入关键词。可以把简历里已有的技能、做法，改用岗位描述里的说法来表述（如简历写 MySQL，岗位写「数据库」，可写成「MySQL 数据库」）；前提是简历原文已经有对应的技能或事实，岗位里有而简历里没有的词一律不写。改动保持在原句结构内，不要整句重写。",
  },
  deep: {
    summary: true,
    maxRewrites: 6,
    minOverlap: 0,
    coveredSkills: true,
    guidance:
      "本次档位：深度改写。可以重写要点的措辞和句式，让表述更贴近岗位的语言和关注点，也可以写个人摘要；但事实不能变：不新增数字、技能、工具、项目或职责，岗位里有而简历里没有的内容不写，不拔高程度。",
  },
};

const COUNTABLE = /[一-龥a-z0-9]/gi;

function bag(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const ch of text.toLowerCase().match(COUNTABLE) ?? []) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}

export function charOverlap(original: string, rewrite: string): number {
  const have = bag(original);
  const want = bag(rewrite);
  let total = 0;
  let shared = 0;
  for (const [ch, n] of want) {
    total += n;
    shared += Math.min(n, have.get(ch) ?? 0);
  }
  return total === 0 ? 1 : shared / total;
}

const skillSet = (text: string) => new Set(findSkills(text).map((h) => h.name));

/** 原文技能集合里有没有任何一个能覆盖这个技能名（自己，或 PARTIAL_COVERAGE 里的下位技能）。 */
function covered(name: string, owned: ReadonlySet<string>): boolean {
  return owned.has(name) || (PARTIAL_COVERAGE[name] ?? []).some((via) => owned.has(via));
}

/**
 * 按档位检查一条改写：新出现的技能名要么是原文有的，要么（嵌入关键词/深度改写）被原文已有技能覆盖；
 * 微调还要求措辞基本沿用原文。返回的词会进入 violations，拦下后不能采用。
 */
export function levelViolations(
  level: TailorLevel,
  original: string,
  rewrite: string,
  extraOwned: readonly string[] = [],
): string[] {
  const rule = LEVEL_RULES[level];
  const owned = new Set([...skillSet(original), ...extraOwned.flatMap((s) => normalizeSkillList(s))]);
  const problems: string[] = [];
  for (const name of skillSet(rewrite)) {
    if (owned.has(name)) continue;
    if (!rule.coveredSkills || !covered(name, owned)) problems.push(`新增技能「${name}」`);
  }
  if (rule.minOverlap > 0 && charOverlap(original, rewrite) < rule.minOverlap)
    problems.push("措辞改动超出本档范围");
  return problems;
}

/** 嵌入关键词和深度改写允许用 JD 标签里「原文已有技能的上位说法」，其余 JD 词仍算越界。 */
export function tagAllowed(level: TailorLevel, original: string, tag: string): boolean {
  if (!LEVEL_RULES[level].coveredSkills) return false;
  const owned = skillSet(original);
  const names = normalizeSkillList(tag).filter((n) => findSkills(n).length > 0);
  return names.length > 0 && names.every((n) => covered(n, owned));
}
