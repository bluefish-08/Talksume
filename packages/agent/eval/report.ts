import { type Metrics, NEW_FIELDS, summarize, summarizeBySection, type UnitResult } from "./metrics.ts";
import type { SampleRun } from "./runner.ts";

export interface ReportMeta {
  model: string;
  fallbackModel: string;
  dataset: string;
  startedAt: Date;
  llmCalls: number;
  llmFailures: number;
  totalTokens: number;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const row = (label: string, m: Metrics) =>
  `| ${label} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.f1)} | ${m.tp} | ${m.fp} | ${m.fn} |`;
const HEADER = "| 范围 | Precision | Recall | F1 | TP | FP | FN |\n|---|---|---|---|---|---|---|";

const SECTION_LABELS: Record<string, string> = {
  basics: "基本信息",
  education: "教育经历",
  experiences: "实习/工作经历",
  projects: "项目经历",
  skills: "技能",
  awards: "获奖",
  intention: "求职意向",
};

const fieldOf = (key: string) => key.match(/\.(\w+)(?:#|$)/)?.[1] ?? "";

function newFieldLines(runs: readonly SampleRun[]): string[] {
  const all = runs.flatMap((r) => r.units);
  const rows = NEW_FIELDS.flatMap((field) => {
    const units = all.filter((u) => fieldOf(u.key) === field);
    return units.length > 0 ? [row(field, summarize(units))] : [];
  });
  const stats = runs.map((r) => {
    const items = [...r.profile.experiences, ...r.profile.projects];
    const highlights = items.flatMap((i) => i.highlights ?? []);
    const titled = highlights.filter((h) => h.title?.trim()).length;
    const stacked = items.filter((i) => (i.techStack ?? []).length > 0).length;
    const edu = r.profile.education.filter((e) => e.gpa || e.rank).length;
    return `| ${r.sample.id} | ${items.length} | ${stacked} | ${highlights.length} | ${titled} | ${edu} |`;
  });
  return [
    "",
    "## 新字段",
    "",
    HEADER,
    ...rows,
    "",
    "| 样例 | 实习+项目条数 | 带技术栈 | 要点数 | 带关键词标题 | 有 GPA/排名的教育 |",
    "|---|---|---|---|---|---|",
    ...stats,
  ];
}

function errorLines(units: readonly UnitResult[]): string[] {
  return units
    .filter((u) => u.status !== "tp")
    .map((u) => {
      const tag = u.status === "fp" ? "误报/错值" : "漏报";
      const detail = [u.expected ? `期望 ${u.expected}` : "", u.predicted ? `实际 ${u.predicted}` : ""]
        .filter(Boolean)
        .join("，");
      return `- ${tag} \`${u.key}\`：${detail}`;
    });
}

export function renderReport(runs: readonly SampleRun[], meta: ReportMeta): string {
  const all = runs.flatMap((r) => r.units);
  const lines: string[] = [
    "# 对话信息抽取评测报告",
    "",
    `- 时间：${meta.startedAt.toISOString()}`,
    `- 模型：${meta.model}（备用 ${meta.fallbackModel}）`,
    `- 数据集：${meta.dataset}，${runs.length} 段对话，${runs.reduce((n, r) => n + r.sample.turns.length, 0)} 轮用户发言`,
    `- 模型调用：${meta.llmCalls} 次（失败 ${meta.llmFailures} 次），共 ${meta.totalTokens} tokens`,
    "- 指标：字段级（micro）。每个标量字段、列表元素各计一项；条目按学校/公司/项目名对齐，自由文本字段按关键词是否齐全判定。",
    "",
    "## 总体",
    "",
    HEADER,
    row("全部", summarize(all)),
    "",
    "## 分区",
    "",
    HEADER,
    ...Object.entries(summarizeBySection(all)).map(([s, m]) => row(SECTION_LABELS[s] ?? s, m)),
    "",
    "## 分样例",
    "",
    HEADER,
    ...runs.map((r) => row(r.sample.id, r.metrics)),
    "",
    "| 样例 | 完整度 | 追问数 | 自动确认的更正 | 调用错误 | 耗时 |",
    "|---|---|---|---|---|---|",
    ...runs.map(
      (r) =>
        `| ${r.sample.id} | ${pct(r.completeness)} | ${r.asks} | ${r.autoConfirmed} | ${r.errors.length} | ${(r.durationMs / 1000).toFixed(1)}s |`,
    ),
    ...newFieldLines(runs),
    "",
    "## 错误明细",
  ];
  for (const r of runs) {
    const details = errorLines(r.units);
    lines.push("", `### ${r.sample.id}`, "", ...(details.length > 0 ? details : ["全部命中。"]));
  }
  for (const r of runs.filter((r, i) => i === 0 || r.sample.id.startsWith("deep-"))) {
    lines.push("", `## 对话（${r.sample.id}）`);
    for (const t of r.transcript)
      lines.push("", `**用户**：${t.user}`, "", `**助手**：${t.assistant || "（无回复）"}`);
  }
  return `${lines.join("\n")}\n`;
}
