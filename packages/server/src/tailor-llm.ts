import {
  applyTailoring,
  DEFAULT_TAILOR_LEVEL,
  polishItemKey,
  polishSourceHash,
  type ResumeContent,
  type ResumeItem,
  resumeText,
  skillNames,
  TAILOR_ITEM_SECTIONS,
  type TailorChange,
  type TailorItemSection,
  type TailorLevel,
  ungroundedTokens,
} from "@talksume/core";
import { z } from "zod";
import type { StructuredLlm } from "./polish-llm.ts";
import { LEVEL_RULES, levelViolations, tagAllowed } from "./tailor-levels.ts";

export interface TailorJob {
  id: string;
  company: string;
  title: string;
  jdText: string;
  tags: string[];
}

export interface TailorDraft {
  changes: TailorChange[];
  model: string;
}

const JD_LIMIT = 2500;

const SYSTEM = `你是中文简历顾问，帮求职者针对一个具体岗位调整简历的侧重点。
你只能做这几件事：
1. 调整顺序：同一段经历里要点的先后、实习/工作经历之间或项目之间的先后、技能的展示先后，把和岗位最相关的放前面。
2. 调整措辞侧重：改写个别要点，让和岗位相关的内容更突出（比如把相关的技术、职责放到句首）。只能重组这条要点原文里已有的信息。
3. 写一句不超过 60 个汉字的个人摘要，概括简历里和这个岗位最相关的经历与技能。
严禁：
- 新增事实。数字、百分比、技术名、工具名、公司/学校/产品名必须在简历原文里出现过；岗位描述里有而简历里没有的技能、经验、关键词，一律不能写进简历。
- 拔高职责（如把参与写成主导），或加「大幅」「显著」等没有依据的程度词。
- 删除、拆分或合并要点。
没必要改的就不改：rewrites 只放确实需要调整措辞的要点，最多 6 条；顺序只在确有更相关的内容排在后面时才调整。reason 用一句话说明和岗位的哪项要求对应。`;

const Reason = z.string().trim().max(120).optional();

const Output = z.object({
  summary: z.object({ text: z.string().trim().min(1).max(160), reason: Reason }).nullish(),
  rewrites: z
    .array(z.object({ id: z.string(), text: z.string().trim().min(1).max(200), reason: Reason }))
    .default([]),
  bulletOrder: z
    .array(z.object({ item: z.string(), order: z.array(z.string()), reason: Reason }))
    .default([]),
  itemOrder: z
    .array(z.object({ section: z.enum(TAILOR_ITEM_SECTIONS), order: z.array(z.string()), reason: Reason }))
    .default([]),
  skillOrder: z.object({ names: z.array(z.string()), reason: Reason }).nullish(),
});
type Output = z.infer<typeof Output>;

interface IndexedItem {
  id: string;
  section: TailorItemSection;
  item: ResumeItem;
  itemKey: string;
  bullets: { id: string; text: string; hash: string }[];
}

function indexResume(resume: ResumeContent): IndexedItem[] {
  const kinds: readonly string[] = TAILOR_ITEM_SECTIONS;
  let items = 0;
  let bullets = 0;
  return resume.sections
    .filter((s) => kinds.includes(s.kind))
    .flatMap((section) =>
      section.items.map((item) => ({
        id: `i${++items}`,
        section: section.kind as TailorItemSection,
        item,
        itemKey: polishItemKey(section.kind, item.heading),
        bullets: item.bullets.map((b) => ({
          id: `b${++bullets}`,
          text: b.text,
          hash: polishSourceHash(b.text),
        })),
      })),
    );
}

const SECTION_LABEL: Record<TailorItemSection, string> = {
  experiences: "实习与工作经历",
  projects: "项目经历",
  campus: "校园经历",
};

function promptOf(
  job: TailorJob,
  resume: ResumeContent,
  index: IndexedItem[],
  level: TailorLevel,
  note?: string,
): string {
  const lines = [
    LEVEL_RULES[level].guidance,
    "",
    "## 目标岗位",
    `${job.company} · ${job.title}${job.tags.length > 0 ? `（标签：${job.tags.join("、")}）` : ""}`,
    job.jdText.slice(0, JD_LIMIT),
    "",
    "## 简历",
    `当前个人摘要：${resume.basics.summary ?? "（无）"}`,
  ];
  for (const section of TAILOR_ITEM_SECTIONS) {
    const items = index.filter((i) => i.section === section);
    if (items.length === 0) continue;
    lines.push(`### ${SECTION_LABEL[section]}（section=${section}）`);
    for (const { id, item, bullets } of items) {
      const head = [item.heading, item.subheading, item.techStack?.join(" / ")].filter(Boolean).join(" · ");
      lines.push(`[${id}] ${head}`, ...bullets.map((b) => `  [${b.id}] ${b.text}`));
    }
  }
  const skills = skillNames(resume);
  if (skills.length > 0) lines.push("### 技能", skills.join("、"));
  lines.push(
    "",
    "按 JSON 返回：summary {text, reason} 或 null；rewrites [{id: 要点 id, text, reason}]；bulletOrder [{item: 条目 id, order: 该条目全部要点 id 的新顺序, reason}]；itemOrder [{section, order: 该分区全部条目 id 的新顺序, reason}]；skillOrder {names: 技能名按展示先后, reason} 或 null。不需要的部分给空数组或 null。",
  );
  if (note) lines.push("", note);
  return lines.join("\n");
}

async function callLlm(
  llm: StructuredLlm,
  prompt: string,
  temperature: number,
  signal?: AbortSignal,
): Promise<{ value: Output; model: string }> {
  const res = await llm.completeStructured({
    purpose: "tailor",
    system: SYSTEM,
    prompt,
    schema: z.toJSONSchema(Output) as Record<string, unknown>,
    validate: (value) => Output.parse(value),
    temperature,
    maxTokens: 2000,
    ...(signal && { signal }),
  });
  return { value: res.value, model: res.model };
}

/** JD 标签里有、原文里没有的词出现在定制结果里，视为把岗位要求当成了自己的经历。 */
function jdOnlyTerms(job: TailorJob, grounding: string, text: string, level: TailorLevel): string[] {
  const lower = grounding.toLowerCase();
  return job.tags.filter(
    (t) =>
      t.trim().length >= 2 &&
      text.includes(t) &&
      !lower.includes(t.toLowerCase()) &&
      !tagAllowed(level, grounding, t),
  );
}

function violationsOf(job: TailorJob, grounding: string, text: string, level: TailorLevel): string[] {
  return [
    ...new Set([
      ...ungroundedTokens(grounding, text),
      ...jdOnlyTerms(job, grounding, text, level),
      ...levelViolations(level, grounding, text),
    ]),
  ];
}

/** 模型给的顺序只取本条目已有的 id，漏掉的按原顺序补在后面，保证是原内容的重排。 */
function permutation(order: readonly string[], ids: readonly string[]): string[] {
  const known = new Set(ids);
  const picked = [...new Set(order.filter((id) => known.has(id)))];
  return [...picked, ...ids.filter((id) => !picked.includes(id))];
}

const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** 改写把同一条目里另一条要点的原文搬进来，等于合并要点，会在定制版里重复出现。 */
function absorbed(owner: IndexedItem, bullet: IndexedItem["bullets"][number], text: string): string[] {
  return owner.bullets
    .map((b) => b.text.trim())
    .filter((t) => t !== bullet.text.trim() && t.length >= 4 && text.includes(t) && !bullet.text.includes(t));
}

interface TextCandidate {
  key: string;
  change: Extract<TailorChange, { kind: "summary" | "bullet" }>;
  grounding: string;
}

function textCandidates(
  out: Output,
  job: TailorJob,
  resume: ResumeContent,
  index: IndexedItem[],
  quotes: readonly string[],
  level: TailorLevel,
): TextCandidate[] {
  const result: TextCandidate[] = [];
  const rule = LEVEL_RULES[level];
  const summary = rule.summary ? out.summary?.text.trim() : undefined;
  if (summary && summary !== resume.basics.summary?.trim()) {
    const grounding = [resumeText(resume), ...quotes].join("\n");
    result.push({
      key: "summary",
      grounding,
      change: {
        id: "summary",
        kind: "summary",
        ...(resume.basics.summary && { before: resume.basics.summary }),
        after: summary,
        ...(out.summary?.reason && { reason: out.summary.reason }),
        violations: violationsOf(job, grounding, summary, level),
      },
    });
  }
  for (const rewrite of out.rewrites.slice(0, rule.maxRewrites)) {
    const owner = index.find((i) => i.bullets.some((b) => b.id === rewrite.id));
    const bullet = owner?.bullets.find((b) => b.id === rewrite.id);
    if (!owner || !bullet || rewrite.text.trim() === bullet.text.trim()) continue;
    if (result.some((r) => r.key === rewrite.id)) continue;
    const { item } = owner;
    const grounding = [bullet.text, item.heading, item.subheading ?? "", ...(item.techStack ?? [])].join(
      "\n",
    );
    result.push({
      key: rewrite.id,
      grounding,
      change: {
        id: `bullet:${owner.itemKey}#${bullet.hash}`,
        kind: "bullet",
        itemKey: owner.itemKey,
        heading: item.heading,
        sourceHash: bullet.hash,
        before: bullet.text,
        after: rewrite.text.trim(),
        ...(rewrite.reason && { reason: rewrite.reason }),
        violations: [
          ...violationsOf(job, grounding, rewrite.text, level),
          ...absorbed(owner, bullet, rewrite.text),
        ],
      },
    });
  }
  return result;
}

function orderChanges(out: Output, resume: ResumeContent, index: IndexedItem[]): TailorChange[] {
  const changes: TailorChange[] = [];
  for (const { item: id, order, reason } of out.bulletOrder) {
    const owner = index.find((i) => i.id === id);
    if (!owner || owner.bullets.length < 2) continue;
    const ids = owner.bullets.map((b) => b.id);
    const next = permutation(order, ids);
    if (sameOrder(next, ids) || changes.some((c) => c.kind === "bullet_order" && c.itemKey === owner.itemKey))
      continue;
    const byId = new Map(owner.bullets.map((b) => [b.id, b]));
    const sorted = next.flatMap((bid) => byId.get(bid) ?? []);
    changes.push({
      id: `bullet_order:${owner.itemKey}`,
      kind: "bullet_order",
      itemKey: owner.itemKey,
      heading: owner.item.heading,
      order: sorted.map((b) => b.hash),
      before: owner.bullets.map((b) => b.text),
      after: sorted.map((b) => b.text),
      ...(reason && { reason }),
      violations: [],
    });
  }
  for (const { section, order, reason } of out.itemOrder) {
    const items = index.filter((i) => i.section === section);
    const ids = items.map((i) => i.id);
    const next = permutation(order, ids);
    if (
      items.length < 2 ||
      sameOrder(next, ids) ||
      changes.some((c) => c.kind === "item_order" && c.section === section)
    )
      continue;
    const byId = new Map(items.map((i) => [i.id, i.item.heading.trim()]));
    changes.push({
      id: `item_order:${section}`,
      kind: "item_order",
      section,
      before: items.map((i) => i.item.heading.trim()),
      after: next.flatMap((iid) => byId.get(iid) ?? []),
      ...(reason && { reason }),
      violations: [],
    });
  }
  const names = skillNames(resume);
  if (out.skillOrder && names.length > 1) {
    const canonical = new Map(names.map((n) => [n.toLowerCase(), n]));
    const wanted = out.skillOrder.names.flatMap((n) => canonical.get(n.trim().toLowerCase()) ?? []);
    const after = permutation(wanted, names);
    const change: TailorChange = {
      id: "skill_order",
      kind: "skill_order",
      before: names,
      after,
      ...(out.skillOrder.reason && { reason: out.skillOrder.reason }),
      violations: [],
    };
    const skillsOf = (r: ResumeContent) => JSON.stringify(r.sections.find((s) => s.kind === "skills"));
    if (skillsOf(applyTailoring(resume, [change])) !== skillsOf(resume)) changes.push(change);
  }
  return changes;
}

/**
 * 顺序调整只会重排已有内容，程序保证；措辞和摘要逐条核对出处，不合格的带着越界词再试一次，
 * 仍不合格就保留违规词，由调用方禁止采用。
 */
export async function tailorWithLlm(
  llm: StructuredLlm,
  job: TailorJob,
  resume: ResumeContent,
  options: { quotes?: readonly string[]; signal?: AbortSignal; level?: TailorLevel } = {},
): Promise<TailorDraft> {
  const quotes = options.quotes ?? [];
  const level = options.level ?? DEFAULT_TAILOR_LEVEL;
  const index = indexResume(resume);
  const first = await callLlm(llm, promptOf(job, resume, index, level), 0.3, options.signal);
  const texts = textCandidates(first.value, job, resume, index, quotes, level);
  let model = first.model;

  const failed = texts.filter((t) => t.change.violations.length > 0);
  if (failed.length > 0) {
    const note = `上一版这些地方出现了这条要点原文里没有的内容（或照搬了另一条要点），必须删掉，只用这条原文已有的信息重写（只需返回这几处，其余给空）：\n${failed
      .map((f) => `${f.key}「${f.change.after}」里的 ${f.change.violations.join("、")}`)
      .join("\n")}`;
    const second = await callLlm(llm, promptOf(job, resume, index, level, note), 0.2, options.signal).catch(
      () => undefined,
    );
    if (second) {
      const retried = textCandidates(second.value, job, resume, index, quotes, level);
      for (const f of failed) {
        const fix = retried.find((r) => r.key === f.key);
        if (fix && fix.change.violations.length < f.change.violations.length) {
          Object.assign(f, fix);
          model = second.model;
        }
      }
    }
  }
  return { changes: [...texts.map((t) => t.change), ...orderChanges(first.value, resume, index)], model };
}
