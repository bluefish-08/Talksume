import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { toolGateway, Usage } from "../lib/llm.ts";
import { pool } from "../lib/stats.ts";
import { loadEnv } from "../lib/target.ts";
import { scoreProfile } from "../metrics.ts";
import { PERSONAS } from "./personas.ts";
import type { RunRecord } from "./run.ts";
import { saidIn } from "./score.ts";

/** a=原话里说过（评测自带的 saidIn）；b=由原话改写或直接推断；c=添加了原话里没有的事实。 */
export type AuditClass = "a" | "b" | "c";

export interface AuditRow {
  version: string;
  persona: string;
  rep: number;
  key: string;
  field: string;
  value: string;
  class: AuditClass;
  why?: string;
}

export interface AuditSummary {
  versions: { label: string; runs: number; fp: number; a: number; b: number; c: number; cPerRun: number }[];
}

const SYSTEM = `你是简历写入的分类器（不是评委）。给你用户在对话里说过的全部原话，和助手写进简历画像的一个字段值。判断它属于：
b = 由原话改写或直接推断而来：信息都能在原话里找到依据，只是换了简历化的说法、归了类，或做了「一个人做的→独立完成」「说熟悉→familiar」这类直接推断；一句话摘要里复述原话内容也算 b。
c = 添加了原话里没有的具体事实、数字、名称、程度、职责或判断（如原话没提的城市、岗位类型、角色、技能熟练度、成果）。
只输出一行 JSON：{"c":"b或c","why":"不超过25字的理由"}`;

type Gw = ReturnType<typeof toolGateway>;

async function classify(
  gw: Gw,
  users: string,
  key: string,
  value: string,
): Promise<{ class: AuditClass; why: string | undefined } | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await gw.complete({
        purpose: "eval.audit",
        system: SYSTEM,
        prompt: `用户原话：\n${users}\n\n字段：${key}\n写入的值：${value}`,
        temperature: 0,
        maxTokens: 120,
        thinking: false,
      });
      const hit = res.text.match(/\{[^}]*\}/);
      const verdict = hit ? (JSON.parse(hit[0]) as { c?: string; why?: string }) : undefined;
      if (verdict?.c === "b" || verdict?.c === "c") return { class: verdict.c, why: verdict.why };
    } catch {}
  }
  return undefined;
}

export function summarize(rows: readonly AuditRow[], runs: readonly RunRecord[]): AuditSummary {
  const labels = [...new Set(runs.map((r) => r.version))];
  return {
    versions: labels.map((label) => {
      const mine = rows.filter((r) => r.version === label);
      const count = (c: AuditClass) => mine.filter((r) => r.class === c).length;
      const n = runs.filter((r) => r.version === label).length;
      return {
        label,
        runs: n,
        fp: mine.length,
        a: count("a"),
        b: count("b"),
        c: count("c"),
        cPerRun: count("c") / n,
      };
    }),
  };
}

export async function audit(runs: readonly RunRecord[], gw: Gw): Promise<AuditRow[]> {
  const todo = runs.flatMap((run) => {
    const persona = PERSONAS.find((p) => p.id === run.persona);
    if (!persona) return [];
    const texts = run.turns.map((t) => t.user);
    const raw = texts.join("\n");
    return scoreProfile(run.profile, persona.expected, texts)
      .filter((u) => u.status === "fp")
      .map((u) => {
        const field = (u.key.split("#")[0] ?? "").split(".").at(-1) ?? "";
        const value = u.predicted ?? "";
        return { run, raw, key: u.key, field, value, said: saidIn(raw, field, value) };
      });
  });
  const rows: AuditRow[] = [];
  await pool(todo, 6, async (t) => {
    const base = {
      version: t.run.version,
      persona: t.run.persona,
      rep: t.run.rep,
      key: t.key,
      field: t.field,
    };
    if (t.said) return void rows.push({ ...base, value: t.value, class: "a" });
    const verdict = await classify(gw, t.raw, t.key, t.value);
    // 分类器连续失败时按 c 计，宁可多报也不让门槛 3b 因为失败而放过
    rows.push({ ...base, value: t.value, class: verdict?.class ?? "c", why: verdict?.why ?? "分类失败" });
  });
  return rows;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { from: { type: "string" }, out: { type: "string" } },
  });
  if (!values.from) throw new Error("用法：node eval/personas/audit.ts --from x.runs.jsonl [--out x.audit]");
  const runs = readFileSync(values.from, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunRecord);
  loadEnv();
  const usage = new Usage();
  const rows = await audit(runs, toolGateway(usage));
  const summary = summarize(rows, runs);
  const out = resolve(values.out ?? values.from.replace(/\.runs\.jsonl$/, ".audit"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.json`, JSON.stringify({ summary, rows }, null, 1));
  const md = [
    "| 版本 | 运行数 | fp | (a) 原话说过 | (b) 改写/推断 | (c) 添加了没说过的事实 | (c) / 次 |",
    "|---|---|---|---|---|---|---|",
    ...summary.versions.map(
      (v) => `| ${v.label} | ${v.runs} | ${v.fp} | ${v.a} | ${v.b} | ${v.c} | ${v.cPerRun.toFixed(3)} |`,
    ),
  ].join("\n");
  writeFileSync(`${out}.md`, `${md}\n`);
  console.log(md);
  console.error(`审计调用：${JSON.stringify(usage.total())}`);
}
