import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { TurnMetrics } from "../../src/index.ts";
import { fakeJobs, fakePolisher, fakeStyler, fakeTailor } from "../lib/fake-jobs.ts";
import { agentGateway, MODEL, Usage } from "../lib/llm.ts";
import { pool, quantile } from "../lib/stats.ts";
import { loadEnv, loadTarget, type Target } from "../lib/target.ts";
import { runTurn, type TurnOutcome } from "../lib/turn.ts";
import { buildState, defaultReplay, type Replay } from "./builder.ts";
import { type Observation, snapshot } from "./checks.ts";
import { PROBES, type Probe } from "./probes.ts";

export interface Trial {
  /** 写入类检查全部通过。 */
  pass: boolean;
  /** 回复类检查（问句数、收尾）全部通过；探针没有回复类检查时为 null。 */
  replyPass: boolean | null;
  checks: Record<string, boolean>;
  reply: string;
  questions: number;
  toolCalls: string[];
  calls: number;
  newFacts: string[];
  newSkips: string[];
  totalMs?: number;
  firstTokenMs?: number;
  attempts: number;
  infraError?: string;
}

export interface ProbeResult {
  id: string;
  title: string;
  n: number;
  passes: number;
  replyPasses: number | null;
  checks: { id: string; label: string; gate: boolean; kind: string; passes: number }[];
  trials: Trial[];
}

export interface ProbeReport {
  meta: {
    target: string;
    commit: string;
    replay: Replay;
    model: string;
    thinking: boolean;
    n: number;
    startedAt: string;
    durationMs: number;
    usage: Usage["rows"];
  };
  probes: ProbeResult[];
}

const MAX_ATTEMPTS = 3;

async function runTrial(target: Target, probe: Probe, replay: Replay, usage: Usage, thinking: boolean) {
  const gw = agentGateway(target, usage);
  for (let attempt = 1; ; attempt++) {
    const { state } = await buildState(target, probe.script, replay);
    const before = snapshot(state);
    const nb = target.agent.nextSlotOf(state);
    const metrics: TurnMetrics[] = [];
    const controller = target.agent.createIntakeController({
      streamFn: gw.streamFn("eval.probe", { thinking }),
      model: gw.primaryModel,
      jobs: fakeJobs,
      tailor: fakeTailor,
      polisher: fakePolisher,
      styles: fakeStyler,
      onMetrics: (m) => metrics.push(m),
    });
    const outcome: TurnOutcome = await runTurn(controller, state, "probe", probe.message, metrics);
    const infra =
      outcome.error ?? (outcome.metrics?.error ? { code: outcome.metrics.error.slice(0, 80) } : undefined);
    if (infra && attempt < MAX_ATTEMPTS) continue;
    const na = target.agent.nextSlotOf(state);
    const obs: Observation = {
      before,
      after: snapshot(state),
      outcome,
      nextBefore: nb && { key: nb.key, required: nb.required },
      nextAfter: na && { key: na.key, required: na.required },
    };
    const checks = Object.fromEntries(probe.checks.map((c) => [c.id, c.test(obs)]));
    const newFacts = obs.after.facts
      .filter((f) => !before.facts.some((b) => b.id === f.id))
      .map((f) => `${f.status === "pending" ? "?" : ""}${f.section}:${JSON.stringify(f.payload)}`);
    const trial: Trial = {
      pass: !infra && probe.checks.every((c) => !c.gate || c.kind !== "write" || checks[c.id]),
      replyPass: probe.checks.some((c) => c.gate && c.kind === "reply")
        ? !infra && probe.checks.every((c) => !c.gate || c.kind !== "reply" || checks[c.id])
        : null,
      checks,
      reply: outcome.reply,
      questions: outcome.questions,
      toolCalls: outcome.toolCalls,
      calls: outcome.metrics?.modelCalls.length ?? 0,
      newFacts,
      newSkips: obs.after.skipped.filter((k) => !before.skipped.includes(k)),
      ...(outcome.metrics && { totalMs: outcome.metrics.totalMs }),
      ...(outcome.metrics?.firstTokenMs !== undefined && { firstTokenMs: outcome.metrics.firstTokenMs }),
      attempts: attempt,
      ...(infra && { infraError: "code" in infra ? String(infra.code) : "unknown" }),
    };
    return trial;
  }
}

export async function runProbes(opts: {
  target: Target;
  probes: Probe[];
  n: number;
  replay: Replay;
  concurrency: number;
  thinking: boolean;
  onTrial?: (probe: Probe, trial: Trial) => void;
}): Promise<ProbeReport> {
  const usage = new Usage();
  const startedAt = new Date();
  const tasks = Array.from({ length: opts.n }, (_, t) => opts.probes.map((p) => ({ p, t }))).flat();
  const trials = await pool(tasks, opts.concurrency, async ({ p }) => {
    const trial = await runTrial(opts.target, p, opts.replay, usage, opts.thinking);
    opts.onTrial?.(p, trial);
    return { id: p.id, trial };
  });
  const probes = opts.probes.map((p): ProbeResult => {
    const mine = trials.filter((t) => t.id === p.id).map((t) => t.trial);
    return {
      id: p.id,
      title: p.title,
      n: mine.length,
      passes: mine.filter((t) => t.pass).length,
      replyPasses: mine.some((t) => t.replyPass !== null) ? mine.filter((t) => t.replyPass).length : null,
      checks: p.checks.map((c) => ({
        id: c.id,
        label: c.label,
        gate: c.gate,
        kind: c.kind,
        passes: mine.filter((t) => t.checks[c.id]).length,
      })),
      trials: mine,
    };
  });
  return {
    meta: {
      target: opts.target.label,
      commit: opts.target.commit,
      replay: opts.replay,
      model: MODEL,
      thinking: opts.thinking,
      n: opts.n,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      usage: usage.rows,
    },
    probes,
  };
}

function topCalls(trials: Trial[]): string {
  const counts = new Map<string, number>();
  for (const t of trials) {
    const k = t.toolCalls.join("+") || "text";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${k}×${v}`)
    .join("，");
}

export function probeMarkdown(report: ProbeReport): string {
  const { meta } = report;
  const total = report.probes.reduce((a, p) => a + p.passes, 0);
  const n = report.probes.reduce((a, p) => a + p.n, 0);
  const withReply = report.probes.filter((p) => p.replyPasses !== null);
  const replyTotal = withReply.reduce((a, p) => a + (p.replyPasses ?? 0), 0);
  const replyN = withReply.reduce((a, p) => a + p.n, 0);
  const rate = (x: number, y: number) => `${x}/${y}（${((x / Math.max(1, y)) * 100).toFixed(1)}%）`;
  const infra = report.probes.flatMap((p) => p.trials).filter((t) => t.infraError).length;
  const tokens = Object.values(meta.usage).reduce((a, r) => a + r.inputTokens + r.outputTokens, 0);
  const lines = [
    `# 探针结果 · ${meta.target}（${meta.commit}）`,
    "",
    `模型 ${meta.model}，思考 ${meta.thinking ? "开" : "关"}，历史回放 ${meta.replay}，每个探针 N=${meta.n}；用时 ${Math.round(meta.durationMs / 1000)}s，token ${tokens}，基础设施失败 ${infra} 次。`,
    "",
    `**写入正确率 ${rate(total, n)}**；回复合规率 ${rate(replyTotal, replyN)}。`,
    "",
    "| 探针 | 写入 | 回复 | 各项检查（* 为不计入通过的观察项，〔回〕为回复类） | 常见调用 | 耗时 p50 |",
    "|---|---|---|---|---|---|",
  ];
  for (const p of report.probes) {
    const checks = p.checks
      .map((c) => `${c.gate ? "" : "*"}${c.kind === "reply" ? "〔回〕" : ""}${c.label} ${c.passes}/${p.n}`)
      .join("；");
    const ms = quantile(
      p.trials.flatMap((t) => (t.totalMs === undefined ? [] : [t.totalMs])),
      0.5,
    );
    lines.push(
      `| ${p.title} | **${p.passes}/${p.n}** | ${p.replyPasses === null ? "—" : `${p.replyPasses}/${p.n}`} | ${checks} | ${topCalls(p.trials)} | ${ms ?? "—"}ms |`,
    );
  }
  return lines.join("\n");
}

async function show(target: Target, probes: Probe[], replay: Replay) {
  for (const p of probes) {
    const { state, log } = await buildState(target, p.script, replay);
    console.log(`\n## ${p.id}`);
    for (const l of log.filter((x) => x.isError))
      console.log(`  ! 第 ${l.turn} 轮 ${l.tool}：${l.result.slice(0, 160)}`);
    for (const t of state.history.filter((h) => h.role === "assistant")) {
      console.log(
        `  ${t.id} slot=${t.meta?.slot ?? "-"} tools=${(t.meta?.tools ?? []).map((r) => r.name).join(",") || "-"}`,
      );
    }
    const next = target.agent.nextSlotOf(state);
    console.log(
      `  next=${next?.key ?? "null"} required=${next?.required ?? "-"} skipped=${state.skipped.map((s) => s.key).join(",")}`,
    );
    console.log(
      `  projects=${state.profile.projects.map((x) => x.name).join("|")} drafts=${state.drafts.length} conflicts=${state.conflicts.length} skills=${state.profile.skills.length}`,
    );
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      n: { type: "string", default: "8" },
      only: { type: "string" },
      replay: { type: "string" },
      target: { type: "string", default: "." },
      concurrency: { type: "string", default: "6" },
      out: { type: "string" },
      thinking: { type: "boolean", default: false },
      show: { type: "boolean", default: false },
    },
  });
  const only = values.only?.split(",");
  const probes = only ? PROBES.filter((p) => only.includes(p.id)) : PROBES;
  const target = await loadTarget(values.target);
  const replay = (values.replay as Replay | undefined) ?? defaultReplay(target);
  if (values.show) {
    await show(target, probes, replay);
  } else {
    loadEnv();
    const report = await runProbes({
      target,
      probes,
      n: Number(values.n),
      replay,
      concurrency: Number(values.concurrency),
      thinking: values.thinking,
      onTrial: (p, t) =>
        console.error(`${p.id} ${t.pass ? "PASS" : "fail"} ${t.toolCalls.join("+") || "text"}`),
    });
    const md = probeMarkdown(report);
    const out = resolve(values.out ?? `eval-out/probes-${report.meta.commit}-${replay}-${Date.now()}`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(`${out}.json`, JSON.stringify(report, null, 2));
    writeFileSync(`${out}.md`, md);
    console.log(md);
    console.log(`\n写入 ${out}.json / .md`);
  }
}
