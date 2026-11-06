import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Fact, Profile } from "@talksume/core";
import type { Gateway } from "@talksume/llm-gateway";
import type { TurnMetrics } from "../../src/index.ts";
import { fakeJobs, fakeStyler, fakeTailor } from "../lib/fake-jobs.ts";
import { agentGateway, MODEL, toolGateway, Usage } from "../lib/llm.ts";
import {
  bootstrapDiff,
  bootstrapQuantile,
  bootstrapRatio,
  type Cluster,
  type Interval,
  pct,
  pool,
  type ValueCluster,
} from "../lib/stats.ts";
import { loadEnv, loadTarget, type Target } from "../lib/target.ts";
import { runTurn } from "../lib/turn.ts";
import { compactProfile, judgeClaim, type Verdict } from "./judge.ts";
import { PERSONAS, type Persona, userSystem } from "./personas.ts";
import { accuracy, duplicatePairs, emptyItems, recallUnits } from "./score.ts";

export interface TurnRecord {
  round: number;
  user: string;
  reply: string;
  questions: number;
  wraps: boolean;
  wrapThenAsk: boolean;
  toolCalls: string[];
  calls: number;
  writes: string[];
  nextAfter: { key: string; required: boolean } | null;
  firstTokenMs?: number;
  totalMs?: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  /** 本轮之前的画像摘要，给判定器用。 */
  profileBefore?: string;
  judge?: Verdict | null;
}

export interface RunRecord {
  version: string;
  commit: string;
  persona: string;
  rep: number;
  endedBy: "wrap" | "max";
  turns: TurnRecord[];
  profile: Profile;
  facts: Fact[];
  skipped: string[];
  pendingConflicts: number;
  durationMs: number;
}

const userId = (p: Persona) => p.name;

async function simulateUser(gw: Gateway, persona: Persona, transcript: string[]): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await gw.complete({
        purpose: "eval.persona.user",
        system: userSystem(persona),
        prompt: `对话记录：\n${transcript.slice(-12).join("\n")}\n\n请以${userId(persona)}的身份回复助手最后一句。`,
        temperature: 0.3,
        maxTokens: 300,
        thinking: false,
      });
      return res.text.trim().replace(new RegExp(`^${persona.name}[：:]\\s*`), "");
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

export async function runConversation(opts: {
  target: Target;
  persona: Persona;
  rep: number;
  agentGw: Gateway;
  simGw: Gateway;
  judgeGw?: Gateway;
  maxTurns: number;
  thinking: boolean;
}): Promise<RunRecord> {
  const { target, persona } = opts;
  const startedAt = Date.now();
  const metrics: TurnMetrics[] = [];
  const controller = target.agent.createIntakeController({
    streamFn: opts.agentGw.streamFn("eval.persona", { thinking: opts.thinking }),
    model: opts.agentGw.primaryModel,
    jobs: fakeJobs,
    tailor: fakeTailor,
    styles: fakeStyler,
    onMetrics: (m) => metrics.push(m),
  });
  const state = target.agent.createIntakeState({ profile: target.core.Profile.parse({}) });
  const transcript: string[] = [];
  const turns: TurnRecord[] = [];
  let text = persona.opening;
  let wrapAt: number | undefined;
  for (let round = 1; round <= opts.maxTurns; round++) {
    const id = `m${round}`;
    const profileBefore = compactProfile(state.profile);
    const out = await runTurn(controller, state, id, text, metrics);
    const m = out.metrics;
    const next = target.agent.nextSlotOf(state);
    const error = out.error?.code ?? m?.error?.slice(0, 80);
    turns.push({
      round,
      profileBefore,
      user: text,
      reply: out.reply,
      questions: out.questions,
      wraps: out.wraps,
      wrapThenAsk: out.wrapThenAsk,
      toolCalls: out.toolCalls,
      calls: m?.modelCalls.length ?? 0,
      writes: state.facts
        .filter((f) => f.sourceMessageId === id)
        .map(
          (f) => `${f.status === "pending" ? "（待确认）" : ""}${f.section}：${JSON.stringify(f.payload)}`,
        ),
      nextAfter: next && { key: next.key, required: next.required },
      ...(m?.firstTokenMs !== undefined && { firstTokenMs: m.firstTokenMs }),
      ...(m && { totalMs: m.totalMs }),
      inputTokens: m?.modelCalls.reduce((a, c) => a + c.inputTokens + c.cacheReadTokens, 0) ?? 0,
      outputTokens: m?.modelCalls.reduce((a, c) => a + c.outputTokens, 0) ?? 0,
      ...(error && { error }),
    });
    transcript.push(`${persona.name}：${text}`, `助手：${out.reply}`);
    if (wrapAt !== undefined) break;
    if (out.wraps && round > 6) wrapAt = round;
    if (round === opts.maxTurns) break;
    text = await simulateUser(opts.simGw, persona, transcript);
  }
  const run: RunRecord = {
    version: target.label,
    commit: target.commit,
    persona: persona.id,
    rep: opts.rep,
    endedBy: wrapAt !== undefined ? "wrap" : "max",
    turns,
    profile: state.profile,
    facts: state.facts,
    skipped: state.skipped.map((s) => s.key),
    pendingConflicts: state.conflicts.length,
    durationMs: Date.now() - startedAt,
  };
  if (opts.judgeGw) await judgeRun(run, opts.judgeGw);
  return run;
}

/** 老记录没存 profileBefore 时，用之前轮次写入的事实代替。 */
function factsBefore(run: RunRecord, round: number): string {
  const prior = run.facts.filter(
    (f) => f.status === "confirmed" && Number(f.sourceMessageId.slice(1)) < round,
  );
  return JSON.stringify(prior.map((f) => ({ [f.section]: f.payload })));
}

export async function judgeRun(run: RunRecord, gw: Gateway): Promise<void> {
  await pool(run.turns, 4, async (t) => {
    if (!t.reply) return;
    try {
      t.judge = await judgeClaim(gw, {
        user: t.user,
        reply: t.reply,
        writes: t.writes,
        profile: t.profileBefore ?? factsBefore(run, t.round),
      });
    } catch {
      t.judge = null;
    }
  });
}

export interface RunMetrics {
  said: number;
  saidRecorded: number;
  tp: number;
  fp: number;
  fn: number;
  unfounded: string[];
  emptyItems: string[];
  dupPairs: string[];
  ungroundedNums: string[];
  turns: number;
  multiQ: number;
  wrapThenAsk: boolean;
  premature: boolean;
  endedByWrap: boolean;
  falseClaims: number;
  judged: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
  firstTokens: number[];
  totals: number[];
  missed: string[];
}

export function runMetrics(run: RunRecord): RunMetrics {
  const persona = PERSONAS.find((p) => p.id === run.persona) as Persona;
  const userTexts = run.turns.map((t) => t.user);
  const acc = accuracy(run.profile, persona.expected, userTexts);
  const recall = recallUnits(acc.units, userTexts).filter((u) => u.said);
  const firstWrap = run.turns.findIndex((t) => t.wraps && t.round > 6);
  const wrapTurn = firstWrap >= 0 ? run.turns[firstWrap] : undefined;
  const after = firstWrap >= 0 ? run.turns[firstWrap + 1] : undefined;
  const judged = run.turns.filter((t) => t.judge);
  return {
    said: recall.length,
    saidRecorded: recall.filter((u) => u.recorded).length,
    tp: acc.metrics.tp,
    fp: acc.metrics.fp,
    fn: acc.metrics.fn,
    unfounded: acc.unfounded.map((u) => `${u.key}=${u.predicted}`),
    emptyItems: emptyItems(run.profile),
    dupPairs: duplicatePairs(run.profile, run.facts),
    ungroundedNums: acc.ungroundedNums,
    turns: run.turns.length,
    multiQ: run.turns.filter((t) => t.questions > 1).length,
    wrapThenAsk: Boolean(wrapTurn && (wrapTurn.wrapThenAsk || (after && after.questions > 0))),
    premature: Boolean(wrapTurn?.nextAfter?.required),
    endedByWrap: run.endedBy === "wrap",
    falseClaims: judged.filter((t) => t.judge?.falseClaim).length,
    judged: judged.length,
    calls: run.turns.reduce((a, t) => a + t.calls, 0),
    inputTokens: run.turns.reduce((a, t) => a + t.inputTokens, 0),
    outputTokens: run.turns.reduce((a, t) => a + t.outputTokens, 0),
    errors: run.turns.filter((t) => t.error).length,
    firstTokens: run.turns.flatMap((t) => (t.firstTokenMs === undefined ? [] : [t.firstTokenMs])),
    totals: run.turns.flatMap((t) => (t.totalMs === undefined ? [] : [t.totalMs])),
    missed: recall.filter((u) => !u.recorded).map((u) => u.key),
  };
}

type Ratio = { id: string; label: string; kind: "pct" | "num"; of: (m: RunMetrics) => [number, number] };

export const RATIOS: Ratio[] = [
  { id: "recall", label: "召回（说过且记下 / 说过）", kind: "pct", of: (m) => [m.saidRecorded, m.said] },
  {
    id: "precision",
    label: "准确性 P（沿用 eval：tp / tp+fp）",
    kind: "pct",
    of: (m) => [m.tp, m.tp + m.fp],
  },
  {
    id: "precisionSaid",
    label: "准确性 P（按原话：用户说过的不算误报）",
    kind: "pct",
    of: (m) => [m.tp, m.tp + m.unfounded.length],
  },
  { id: "unfounded", label: "无依据写入 / 次", kind: "num", of: (m) => [m.unfounded.length, 1] },
  { id: "emptyItems", label: "空条目数 / 次", kind: "num", of: (m) => [m.emptyItems.length, 1] },
  { id: "dupItems", label: "疑似重复条目对 / 次", kind: "num", of: (m) => [m.dupPairs.length, 1] },
  {
    id: "ungrounded",
    label: "要点里原话没有的数字 / 次",
    kind: "num",
    of: (m) => [m.ungroundedNums.length, 1],
  },
  { id: "multiQ", label: "问句 >1 的轮次占比", kind: "pct", of: (m) => [m.multiQ, m.turns] },
  { id: "wrapThenAsk", label: "收尾后又提问（次占比）", kind: "pct", of: (m) => [Number(m.wrapThenAsk), 1] },
  { id: "premature", label: "过早收尾（次占比）", kind: "pct", of: (m) => [Number(m.premature), 1] },
  {
    id: "noWrap",
    label: "到轮数上限仍未收尾（次占比）",
    kind: "pct",
    of: (m) => [Number(!m.endedByWrap), 1],
  },
  { id: "falseClaim", label: "假称已记录（轮次占比）", kind: "pct", of: (m) => [m.falseClaims, m.judged] },
  { id: "turns", label: "轮数 / 次", kind: "num", of: (m) => [m.turns, 1] },
  { id: "callsPerTurn", label: "每轮模型调用", kind: "num", of: (m) => [m.calls, m.turns] },
  { id: "inTokPerTurn", label: "每轮输入 token（含缓存）", kind: "num", of: (m) => [m.inputTokens, m.turns] },
  { id: "outTokPerTurn", label: "每轮输出 token", kind: "num", of: (m) => [m.outputTokens, m.turns] },
  { id: "errorTurns", label: "出错轮次占比", kind: "pct", of: (m) => [m.errors, m.turns] },
];

const LATENCY = [
  { id: "firstP50", label: "首字 p50（ms）", q: 0.5, of: (m: RunMetrics) => m.firstTokens },
  { id: "firstP90", label: "首字 p90（ms）", q: 0.9, of: (m: RunMetrics) => m.firstTokens },
  { id: "totalP50", label: "整轮 p50（ms）", q: 0.5, of: (m: RunMetrics) => m.totals },
  { id: "totalP90", label: "整轮 p90（ms）", q: 0.9, of: (m: RunMetrics) => m.totals },
];

export interface Summary {
  versions: { label: string; commit: string; runs: number }[];
  metrics: { id: string; label: string; kind: string; values: Interval[]; diff?: Interval }[];
  byPersona: {
    persona: string;
    version: string;
    runs: number;
    recall: number | null;
    precision: number | null;
    turns: number;
  }[];
}

export function summarize(runs: RunRecord[]): Summary {
  const labels = [...new Set(runs.map((r) => r.version))];
  const groups = labels.map((l) => runs.filter((r) => r.version === l).map((r) => ({ r, m: runMetrics(r) })));
  const clusters = (g: (typeof groups)[number], ratio: Ratio): Cluster[] =>
    g.map(({ r, m }) => {
      const [num, den] = ratio.of(m);
      return { stratum: r.persona, num, den };
    });
  const values = (g: (typeof groups)[number], of: (m: RunMetrics) => number[]): ValueCluster[] =>
    g.map(({ r, m }) => ({ stratum: r.persona, values: of(m) }));
  const two = groups.length === 2 ? (groups as [(typeof groups)[0], (typeof groups)[0]]) : undefined;
  const metrics: Summary["metrics"] = [
    ...RATIOS.map((ratio) => ({
      id: ratio.id,
      label: ratio.label,
      kind: ratio.kind,
      values: groups.map((g) => bootstrapRatio(clusters(g, ratio))),
      ...(two && { diff: bootstrapDiff(clusters(two[0], ratio), clusters(two[1], ratio)) }),
    })),
    ...LATENCY.map((l) => ({
      id: l.id,
      label: l.label,
      kind: "ms",
      values: groups.map((g) => bootstrapQuantile(values(g, l.of), l.q)),
      ...(two && { diff: bootstrapQuantile(values(two[0], l.of), l.q, values(two[1], l.of)) }),
    })),
  ];
  const byPersona = groups.flatMap((g) =>
    PERSONAS.flatMap((p) => {
      const mine = g.filter(({ r }) => r.persona === p.id);
      if (mine.length === 0) return [];
      const sum = (f: (m: RunMetrics) => number) => mine.reduce((a, x) => a + f(x.m), 0);
      return [
        {
          persona: p.id,
          version: mine[0]?.r.version ?? "",
          runs: mine.length,
          recall: sum((m) => m.said) ? sum((m) => m.saidRecorded) / sum((m) => m.said) : null,
          precision: sum((m) => m.tp + m.fp) ? sum((m) => m.tp) / sum((m) => m.tp + m.fp) : null,
          turns: sum((m) => m.turns) / mine.length,
        },
      ];
    }),
  );
  return {
    versions: groups.map((g) => ({
      label: g[0]?.r.version ?? "",
      commit: g[0]?.r.commit ?? "",
      runs: g.length,
    })),
    metrics,
    byPersona,
  };
}

function fmt(kind: string, v: number | null): string {
  if (v === null) return "—";
  if (kind === "pct") return pct(v);
  if (kind === "ms") return String(Math.round(v));
  return v >= 100 ? String(Math.round(v)) : v.toFixed(2);
}

const ci = (kind: string, i: Interval) =>
  `${fmt(kind, i.estimate)} [${fmt(kind, i.low)}, ${fmt(kind, i.high)}]`;

export function summaryMarkdown(s: Summary, usage?: Usage["rows"], seconds?: number): string {
  const head = s.versions.map((v) => `${v.label}（${v.commit}，${v.runs} 次）`);
  const lines = [
    "# 多人设整段对话",
    "",
    `模型 ${MODEL}。括号里是按运行聚类、按人设分层的 bootstrap 95% 区间。${seconds ? `用时 ${Math.round(seconds)}s。` : ""}`,
    "",
    `| 指标 | ${head.join(" | ")} |${s.versions.length === 2 ? " 差（后 − 前） |" : ""}`,
    `|---|${head.map(() => "---|").join("")}${s.versions.length === 2 ? "---|" : ""}`,
  ];
  for (const m of s.metrics) {
    const cells = m.values.map((v) => ci(m.kind, v));
    lines.push(`| ${m.label} | ${cells.join(" | ")} |${m.diff ? ` ${ci(m.kind, m.diff)} |` : ""}`);
  }
  lines.push("", "| 人设 | 版本 | 次数 | 召回 | 准确性 | 平均轮数 |", "|---|---|---|---|---|---|");
  for (const p of s.byPersona) {
    lines.push(
      `| ${p.persona} | ${p.version} | ${p.runs} | ${pct(p.recall)} | ${pct(p.precision)} | ${p.turns.toFixed(1)} |`,
    );
  }
  if (usage) {
    lines.push("", "| purpose | 调用 | 失败 | 输入 token | 输出 token |", "|---|---|---|---|---|");
    for (const [k, r] of Object.entries(usage)) {
      lines.push(`| ${k} | ${r.calls} | ${r.failed} | ${r.inputTokens} | ${r.outputTokens} |`);
    }
  }
  return lines.join("\n");
}

function writeReport(out: string, runs: RunRecord[], usage?: Usage["rows"], seconds?: number) {
  const summary = summarize(runs);
  const md = summaryMarkdown(summary, usage, seconds);
  const perRun = runs.map((r) => {
    const m = runMetrics(r);
    const { firstTokens: _f, totals: _t, ...rest } = m;
    return { version: r.version, persona: r.persona, rep: r.rep, endedBy: r.endedBy, ...rest };
  });
  writeFileSync(`${out}.json`, JSON.stringify({ summary, usage, perRun }, null, 2));
  writeFileSync(`${out}.md`, md);
  return md;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      a: { type: "string", default: "." },
      b: { type: "string" },
      reps: { type: "string", default: "8" },
      personas: { type: "string" },
      concurrency: { type: "string", default: "4" },
      "max-turns": { type: "string", default: "30" },
      out: { type: "string" },
      thinking: { type: "boolean", default: false },
      "no-judge": { type: "boolean", default: false },
      from: { type: "string", multiple: true },
      rejudge: { type: "boolean", default: false },
    },
  });
  if (values.from) {
    const runs = values.from.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RunRecord),
    );
    const out = resolve(values.out ?? values.from[0]?.replace(/\.runs\.jsonl$/, "") ?? "eval-out/personas");
    if (values.rejudge) {
      loadEnv();
      const usage = new Usage();
      const gw = toolGateway(usage);
      await pool(runs, 4, (r) => judgeRun(r, gw));
      writeFileSync(`${out}.runs.jsonl`, runs.map((r) => JSON.stringify(r)).join("\n") + "\n");
      console.error(`重新判定：${JSON.stringify(usage.total())}`);
    }
    console.log(writeReport(out, runs));
  } else {
    loadEnv();
    const targets = [await loadTarget(values.a, values.b ? "A" : undefined)];
    if (values.b) targets.push(await loadTarget(values.b, "B"));
    if (!values.b && targets[0]) targets[0].label = targets[0].commit;
    const personas = values.personas
      ? PERSONAS.filter((p) => values.personas?.split(",").includes(p.id))
      : PERSONAS;
    const reps = Number(values.reps);
    const usage = new Usage();
    const simGw = toolGateway(usage);
    const judgeGw = values["no-judge"] ? undefined : toolGateway(usage);
    const gws = targets.map((t) => agentGateway(t, usage));
    const tasks = Array.from({ length: reps }, (_, rep) =>
      personas.flatMap((persona) => {
        const order = rep % 2 === 0 ? targets.map((_, i) => i) : targets.map((_, i) => i).reverse();
        return order.map((ti) => ({ rep, persona, ti }));
      }),
    ).flat();
    const out = resolve(
      values.out ?? `eval-out/personas-${targets.map((t) => t.commit).join("-vs-")}-${Date.now()}`,
    );
    mkdirSync(dirname(out), { recursive: true });
    const started = Date.now();
    const runs = await pool(tasks, Number(values.concurrency), async ({ rep, persona, ti }) => {
      const target = targets[ti] as Target;
      const run = await runConversation({
        target,
        persona,
        rep,
        agentGw: gws[ti] as Gateway,
        simGw,
        ...(judgeGw && { judgeGw }),
        maxTurns: Number(values["max-turns"]),
        thinking: values.thinking,
      });
      appendFileSync(`${out}.runs.jsonl`, `${JSON.stringify(run)}\n`);
      const m = runMetrics(run);
      console.error(
        `${target.label} ${persona.id}#${rep} turns=${m.turns} recall=${m.saidRecorded}/${m.said} fp=${m.fp} empty=${m.emptyItems.length} dup=${m.dupPairs.length} false=${m.falseClaims} ${run.endedBy}`,
      );
      return run;
    });
    console.log(writeReport(out, runs, usage.rows, (Date.now() - started) / 1000));
    console.log(`\n写入 ${out}.json / .md / .runs.jsonl`);
  }
}
