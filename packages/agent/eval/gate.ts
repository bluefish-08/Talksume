import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { bootstrapDiff, type Cluster, fisher, type Interval, pct } from "./lib/stats.ts";
import type { AuditSummary } from "./personas/audit.ts";
import type { Summary } from "./personas/run.ts";
import type { ProbeReport } from "./probes/run.ts";

const read = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;

export interface ProbeDiff {
  id: string;
  title: string;
  base: [number, number];
  cand: [number, number];
  diff: number;
  p: number;
}

export function compareProbes(base: ProbeReport, cand: ProbeReport) {
  const rows: ProbeDiff[] = base.probes.flatMap((b) => {
    const c = cand.probes.find((x) => x.id === b.id);
    if (!c) return [];
    return [
      {
        id: b.id,
        title: b.title,
        base: [b.passes, b.n],
        cand: [c.passes, c.n],
        diff: c.passes / c.n - b.passes / b.n,
        p: fisher(b.passes, b.n, c.passes, c.n),
      },
    ];
  });
  const clusters = (r: ProbeReport): Cluster[] =>
    r.probes
      .filter((p) => rows.some((x) => x.id === p.id))
      .flatMap((p) => p.trials.map((t) => ({ stratum: p.id, num: Number(t.pass), den: 1 })));
  const overall = bootstrapDiff(clusters(base), clusters(cand));
  const replyClusters = (r: ProbeReport): Cluster[] =>
    r.probes
      .filter((p) => p.replyPasses !== null && rows.some((x) => x.id === p.id))
      .flatMap((p) => p.trials.map((t) => ({ stratum: p.id, num: Number(t.replyPass), den: 1 })));
  const reply = bootstrapDiff(replyClusters(base), replyClusters(cand));
  return { rows, overall, reply };
}

const fmtCi = (i: Interval, f: (v: number | null | undefined) => string = pct) =>
  `${f(i.estimate)} [${f(i.low)}, ${f(i.high)}]`;

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      cand: { type: "string" },
      personas: { type: "string" },
      audit: { type: "string" },
      out: { type: "string" },
    },
  });
  const lines: string[] = [];
  const verdicts: { gate: string; ok: boolean | null; detail: string }[] = [];
  if (values.base && values.cand) {
    const base = read<ProbeReport>(values.base);
    const cand = read<ProbeReport>(values.cand);
    const { rows, overall, reply } = compareProbes(base, cand);
    lines.push(
      `# 探针对比：${base.meta.commit}/${base.meta.replay} → ${cand.meta.commit}/${cand.meta.replay}`,
      "",
      "| 探针 | 写入·前 | 写入·后 | 差 | Fisher p |",
      "|---|---|---|---|---|",
      ...rows.map(
        (r) =>
          `| ${r.title} | ${r.base[0]}/${r.base[1]} | ${r.cand[0]}/${r.cand[1]} | ${r.diff >= 0 ? "+" : ""}${Math.round(r.diff * r.base[1])} | ${r.p.toFixed(3)} |`,
      ),
      "",
      `写入正确率差（后 − 前）：${fmtCi(overall)}，按探针分层、逐次重抽的 bootstrap。`,
      `回复合规率差（后 − 前，不计入门槛）：${fmtCi(reply)}`,
      `单个探针最大差：${Math.max(...rows.map((r) => Math.abs(Math.round(r.diff * r.base[1]))))}/${base.meta.n}`,
    );
    const worst = Math.min(...rows.map((r) => r.diff));
    verdicts.push(
      { gate: "探针写入正确率提升且 95% 区间不跨 0", ok: (overall.low ?? 0) > 0, detail: fmtCi(overall) },
      {
        gate: "任何单个探针不退步超过 2/8",
        ok: worst >= -2 / 8 - 1e-9,
        detail: `最差 ${Math.round(worst * 8)}/8`,
      },
    );
  }
  if (values.personas) {
    const { summary } = read<{ summary: Summary }>(values.personas);
    const m = (id: string) => summary.metrics.find((x) => x.id === id);
    const prec = m("precision");
    const said = m("precisionSaid");
    const first = m("firstP50");
    const empty = m("emptyItems");
    const dup = m("dupItems");
    if (summary.versions.length !== 2 || !prec?.diff || !said?.diff || !first?.values[0] || !first.diff) {
      verdicts.push({ gate: "多人设门槛", ok: null, detail: "需要 --a/--b 两个版本的交替运行结果" });
    } else {
      const base = first.values[0].estimate ?? 0;
      lines.push("", `参考：沿用 eval 的 P（tp / tp+fp）差 ${fmtCi(prec.diff)}，不再作为门槛。`);
      const [from, to] = summary.versions;
      const audit = values.audit ? read<{ summary: AuditSummary }>(values.audit).summary : undefined;
      const cOf = (label?: string) => audit?.versions.find((v) => v.label === label);
      const [cBase, cCand] = [cOf(from?.label), cOf(to?.label)];
      verdicts.push(
        {
          gate: "3a 按原话口径的 P 不显著下降（差的 95% 区间上界 ≥ 0）",
          ok: (said.diff.high ?? -1) >= 0,
          detail: fmtCi(said.diff),
        },
        {
          gate: "3b 编造 (c) 每次运行均值不高于基线",
          ok: cBase && cCand ? cCand.cPerRun <= cBase.cPerRun : null,
          detail:
            cBase && cCand
              ? `基线 ${cBase.cPerRun.toFixed(3)}（${cBase.c}/${cBase.runs}），新版本 ${cCand.cPerRun.toFixed(3)}（${cCand.c}/${cCand.runs}）`
              : "缺数据：没有审计输出（--audit，先跑 personas/audit.ts）",
        },
        {
          gate: "整段对话里空或重复条目为 0（新版本）",
          ok: (empty?.values[1]?.estimate ?? 1) === 0 && (dup?.values[1]?.estimate ?? 1) === 0,
          detail: `空 ${empty?.values[1]?.estimate}，重复对 ${dup?.values[1]?.estimate}（每次运行平均）`,
        },
        {
          gate: "首字 p50 不比基线慢 20% 以上",
          ok: (first.diff.estimate ?? 0) <= base * 0.2,
          detail: `基线 ${Math.round(base)}ms，差 ${fmtCi(first.diff, (v) => (v === null || v === undefined ? "—" : `${Math.round(v)}ms`))}`,
        },
      );
    }
  }
  lines.push(
    "",
    "## 合并门槛",
    "",
    "| 门槛 | 结果 | 依据 |",
    "|---|---|---|",
    ...verdicts.map(
      (v) => `| ${v.gate} | ${v.ok === null ? "缺数据" : v.ok ? "通过" : "**未过**"} | ${v.detail} |`,
    ),
  );
  const md = lines.join("\n");
  console.log(md);
  if (values.out) writeFileSync(values.out, md);
}
