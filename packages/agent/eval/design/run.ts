// 设计评测：直连真实模型，走真实的服务端 propose（校验、渲染、审计、ATS），不经过 HTTP。
// 用法见 eval/README.md「设计评测」。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { DesignOption, IntakeEvent, ResumeStyler } from "../../src/index.ts";
import { agentGateway, toolGateway, Usage } from "../lib/llm.ts";
import { pool } from "../lib/stats.ts";
import { loadEnv, loadTarget } from "../lib/target.ts";
import { aestheticOf, type Scores, visionCanary } from "./judge.ts";
import { featureDistance, imageDistances, mean } from "./metrics.ts";

// 跨包的源码用路径动态加载：agent 的 tsconfig 不收其它包，评测脚本也不该被它们的类型检查牵着。
const HERE = dirname(fileURLToPath(import.meta.url));
const load = (path: string) => import(pathToFileURL(resolve(HERE, path)).href);
// biome-ignore lint/suspicious/noExplicitAny: 动态加载的跨包模块只用到几个函数
type Dyn = any;

const SCENARIOS = [
  { id: "fresh-designy", text: "帮我设计一下简历的样子，想要清爽一点、有设计感，给我几个版式看看。" },
  { id: "steady-eng", text: "换个稳重一点的理工风，给我几个看看。" },
  { id: "literary", text: "我是文科生，想要文艺一点、温柔一点的简历版式，来几个。" },
  { id: "no-words", text: "帮我换个好看的简历样式吧。" },
  { id: "lively", text: "想要活泼、年轻、有个性的简历，来几个版式让我挑。" },
] as const;
const AGAIN = "这几个都不太喜欢，再给我三个不一样的。";

export interface OptionRecord {
  direction?: string;
  name: string;
  skeleton: string;
  features: Record<string, string>;
  check: DesignOption["check"];
  ats: DesignOption["ats"];
  textUnchanged: boolean;
  thumbnail: string;
  style: object;
  scores?: Scores;
}

export interface GroupRecord {
  turn: 1 | 2;
  options: OptionRecord[];
  asks: number;
  ms: number;
  toolCalls: string[];
  reply: string;
}

export interface RunRecord {
  scenario: string;
  rep: number;
  groups: GroupRecord[];
  error?: string;
}

/** 只比字母和数字：技能标签样式本来就不带顿号冒号。 */
const chars = (t: string) => [...t.replace(/[^\p{L}\p{N}]/gu, "")].sort().join("");
const hueBucket = (hex: string, hue: (h: string) => { h: number }) => String(Math.floor(hue(hex).h / 30));

async function main() {
  const { values } = parseArgs({
    options: {
      reps: { type: "string", default: "4" },
      target: { type: "string" },
      out: { type: "string" },
      scenarios: { type: "string" },
      concurrency: { type: "string", default: "3" },
      "vision-judge": { type: "boolean", default: false },
    },
  });
  loadEnv();
  const target = await loadTarget(values.target);
  const { createDb, migrate, schema }: Dyn = await load("../../../db/src/index.ts");
  const { storeResumeStyler }: Dyn = await load("../../../server/src/resume-style.ts");
  const render: Dyn = await load("../../../resume-render/src/index.ts");
  const corpus: Dyn = await load("../../../resume-render/src/security-corpus.ts");
  const usage = new Usage();
  const agentGw = agentGateway(target, usage);
  const judgeGw = toolGateway(usage);
  const handle = await createDb({ pglite: "memory://" });
  await migrate(handle);
  const [user] = await handle.db
    .insert(schema.users)
    .values({ email: "design-eval@example.com" })
    .returning({ id: schema.users.id });
  const userId = (user as { id: string }).id;
  const profile = render.sampleProfile;
  const plain = render.sampleResume;

  const scenarios = values.scenarios
    ? SCENARIOS.filter((s) => values.scenarios?.split(",").includes(s.id))
    : SCENARIOS;
  const tasks = Array.from({ length: Number(values.reps) }, (_, rep) =>
    scenarios.map((s) => ({ s, rep })),
  ).flat();
  const out = resolve(values.out ?? `eval-out/design-${target.commit}-${Date.now()}`);
  mkdirSync(dirname(out), { recursive: true });

  const runOne = async ({ s, rep }: { s: (typeof SCENARIOS)[number]; rep: number }): Promise<RunRecord> => {
    const seen: string[] = [];
    const base = storeResumeStyler(handle.db, userId, { profile: () => profile });
    const styler: ResumeStyler = {
      ...base,
      async recentDirections() {
        return seen;
      },
    };
    const controller = target.agent.createIntakeController({
      streamFn: agentGw.streamFn("eval.design", { thinking: false }),
      model: agentGw.primaryModel,
      styles: styler,
    });
    const state = target.agent.createIntakeState({ profile });
    const groups: GroupRecord[] = [];
    try {
      for (const [i, text] of [s.text, AGAIN].entries()) {
        const t0 = Date.now();
        let reply = "";
        let asks = 0;
        let options: DesignOption[] = [];
        const toolCalls: string[] = [];
        for await (const event of controller.handleUserMessage(state, {
          id: `m${i}`,
          text,
        }) as AsyncIterable<IntakeEvent>) {
          if (event.type === "token") reply += event.text;
          else if (event.type === "ask") asks++;
          else if (event.type === "style_options") options = event.options;
        }
        for (const t of state.history.at(-1)?.meta?.tools ?? []) toolCalls.push(t.name);
        for (const o of options) if (o.direction) seen.unshift(o.direction);
        const records: OptionRecord[] = [];
        for (const o of options) {
          const theme = o.style.theme;
          const css = o.style.css ?? "";
          const textRender = await render.renderResumePng(render.maskContacts(plain), o.style, {
            scale: 0.3,
            format: "jpeg",
          });
          const plainMasked = await render.renderResumePng(
            render.maskContacts(plain),
            target.core.DEFAULT_RESUME_STYLE,
            { scale: 0.3, format: "jpeg" },
          );
          records.push({
            ...(o.direction ? { direction: o.direction } : {}),
            name: o.name,
            skeleton: theme?.skeleton ?? "classic",
            features: {
              skeleton: theme?.skeleton ?? "classic",
              bodyFont: theme?.bodyFont ?? "",
              headingFont: theme?.headingFont ?? "",
              header: theme?.header ?? "",
              headingStyle: theme?.headingStyle ?? "",
              bullet: theme?.bullet ?? "",
              skills: theme?.skills ?? "",
              hue: theme ? hueBucket(theme.accent, target.core.hue) : "",
              decor: String(Math.min(3, Math.ceil((css.match(/::(?:before|after)/g)?.length ?? 0) / 3))),
            },
            check: o.check,
            ats: o.ats,
            textUnchanged: chars(textRender.check.text) === chars(plainMasked.check.text),
            thumbnail: o.thumbnail,
            style: o.style,
          });
        }
        groups.push({
          turn: (i + 1) as 1 | 2,
          options: records,
          asks,
          ms: Date.now() - t0,
          toolCalls,
          reply: reply.trim(),
        });
        if (options.length === 0) break;
      }
      return { scenario: s.id, rep, groups };
    } catch (error) {
      return { scenario: s.id, rep, groups, error: String(error).slice(0, 200) };
    }
  };

  console.error(`design eval：${tasks.length} 次 × 2 轮，目标 ${target.label}`);
  const runs = await pool(tasks, Number(values.concurrency), async (t) => {
    const r = await runOne(t);
    console.error(
      `${r.scenario}#${r.rep}：${r.groups.map((g) => `${g.options.map((o) => o.direction ?? o.name).join("/")} ${Math.round(g.ms / 1000)}s`).join(" → ")}${r.error ? ` 出错 ${r.error}` : ""}`,
    );
    return r;
  });
  writeFileSync(`${out}.runs.json`, JSON.stringify(runs));

  // 设计标准量化（确定性）：层级、对齐、留白、对比度各 1–5；预设模板作对照
  const masked = render.maskContacts(plain);
  const allOptions = runs.flatMap((r) => r.groups.flatMap((g) => g.options));
  const quant: Scores[] = await pool(allOptions, 4, (o) => render.designScore(masked, o.style));
  quant.forEach((sc, i) => {
    const o = allOptions[i];
    if (o) o.scores = sc;
  });
  const presets = await pool([...target.core.RESUME_TEMPLATES], 2, async (template: string) => ({
    template,
    scores: (await render.designScore(masked, { template, accent: "blue" })) as Scores,
  }));
  const judged = { generated: quant, presets };
  // 模型看图评分只在配置了能看图的评审模型时才有效：先过看图金丝雀，否则不报
  let vision: { valid: boolean; mean: number | null } | undefined;
  if (values["vision-judge"]) {
    const shot = async (style: object) =>
      Buffer.from((await render.renderResumePng(masked, style, { scale: 0.9, format: "jpeg" })).png).toString(
        "base64",
      );
    const valid = await visionCanary(
      judgeGw,
      await shot({ template: "modern", accent: "blue" }),
      await shot({ template: "minimal", accent: "blue" }),
    );
    if (!valid) vision = { valid, mean: null };
    else {
      const sample = allOptions.filter((o) => o.thumbnail);
      const got = await pool(sample, 4, (o) => aestheticOf(judgeGw, o.thumbnail.replace(/^data:[^,]*,/, "")));
      vision = { valid, mean: mean(got.map((x: Scores) => x.overall)) };
    }
  }

  const firstGroups = runs.flatMap((r) => r.groups.filter((g) => g.turn === 1));
  const secondGroups = runs.flatMap((r) => r.groups.filter((g) => g.turn === 2));
  const allGroups = [...firstGroups, ...secondGroups];
  const options = allGroups.flatMap((g) => g.options);
  const rate = (n: number, d: number) => (d === 0 ? null : n / d);
  const attackResults = await Promise.all(
    corpus.ATTACKS.map((a: { id: string; css: string }) =>
      corpus.runAttack(a, plain, target.core.DEFAULT_RESUME_STYLE),
    ),
  );
  const imageDist = await imageDistances(
    allGroups.filter((g) => g.options.length > 1).map((g) => g.options.map((o) => o.thumbnail)),
  );
  const repeats = runs.map((r) => {
    const [a, b] = r.groups;
    if (!a || !b) return null;
    const first = new Set(a.options.map((o) => o.direction));
    return b.options.filter((o) => o.direction && first.has(o.direction)).length;
  });
  const byScenario = scenarios.map((s) => {
    const dirs = runs
      .filter((r) => r.scenario === s.id)
      .flatMap((r) => r.groups[0]?.options.map((o) => o.direction ?? o.name) ?? []);
    return { id: s.id, shown: dirs.length, distinct: new Set(dirs).size };
  });
  const summary: DesignSummary = {
    target: target.label,
    runs: runs.length,
    groups: allGroups.length,
    shownRate: rate(allGroups.filter((g) => g.options.length === 3).length, allGroups.length),
    sameSkeletonGroups: allGroups.filter(
      (g) => new Set(g.options.map((o) => o.skeleton)).size < g.options.length,
    ).length,
    asksAfterDesigns: allGroups.filter((g) => g.options.length > 0 && g.asks > 0).length,
    onePage: rate(options.filter((o) => o.check.pages === 1).length, options.length),
    contentUnchanged: rate(options.filter((o) => o.textUnchanged).length, options.length),
    cleanRender: rate(
      options.filter(
        (o) =>
          o.check.covered === 0 &&
          o.check.hiddenText === 0 &&
          o.check.lowContrast === 0 &&
          o.check.overflowX === 0,
      ).length,
      options.length,
    ),
    atsReadable: rate(options.filter((o) => o.ats.ok).length, options.length),
    attackBlocked: rate(
      attackResults.filter((a: { blocked: boolean }) => a.blocked).length,
      attackResults.length,
    ),
    attacksMissed: attackResults
      .filter((a: { blocked: boolean }) => !a.blocked)
      .map((a: { id: string }) => a.id),
    featureDistance: mean(
      allGroups
        .filter((g) => g.options.length > 1)
        .map((g) => featureDistance(g.options.map((o) => o.features))),
    ),
    imageDistance: imageDist,
    turn2RepeatsOfTurn1: repeats.filter((x): x is number => x !== null),
    directionsPerScenario: byScenario,
    seconds: {
      p50: median(allGroups.map((g) => g.ms / 1000)),
      max: Math.max(...allGroups.map((g) => g.ms / 1000)),
    },
    vision: vision ?? null,
    aesthetic: judged
      ? {
          generatedMean: mean(judged.generated.map((x) => x.overall)),
          generatedByCriterion: criteria(judged.generated),
          presetsMean: mean(judged.presets.map((x) => x.scores.overall)),
          presets: judged.presets.map((p) => ({ template: p.template, overall: p.scores.overall })),
        }
      : null,
    usage: usage.total(),
  };
  writeFileSync(`${out}.json`, JSON.stringify({ summary, runs }, null, 1));
  writeFileSync(`${out}.md`, report(summary));
  console.log(report(summary));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const criteria = (xs: Scores[]) => ({
  hierarchy: mean(xs.map((x) => x.hierarchy)),
  alignment: mean(xs.map((x) => x.alignment)),
  whitespace: mean(xs.map((x) => x.whitespace)),
  contrast: mean(xs.map((x) => x.contrast)),
});
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : v.toFixed(d));

interface DesignSummary {
  target: string;
  runs: number;
  groups: number;
  shownRate: number | null;
  sameSkeletonGroups: number;
  asksAfterDesigns: number;
  onePage: number | null;
  contentUnchanged: number | null;
  cleanRender: number | null;
  atsReadable: number | null;
  attackBlocked: number | null;
  attacksMissed: string[];
  featureDistance: number | null;
  imageDistance: number | null;
  turn2RepeatsOfTurn1: number[];
  directionsPerScenario: { id: string; shown: number; distinct: number }[];
  seconds: { p50: number; max: number };
  vision: { valid: boolean; mean: number | null } | null;
  aesthetic: {
    generatedMean: number | null;
    generatedByCriterion: Record<"hierarchy" | "alignment" | "whitespace" | "contrast", number | null>;
    presetsMean: number | null;
    presets: { template: string; overall: number }[];
  } | null;
  usage: { calls: number; inputTokens: number; outputTokens: number };
}

function report(s: DesignSummary): string {
  return [
    `# 设计评测：${s.target}`,
    "",
    `${s.runs} 次运行 / ${s.groups} 组（每次两轮：首轮按风格词，次轮要求「再来三个不一样的」）`,
    "",
    "## 底线指标",
    "",
    "| 指标 | 结果 | 要求 | 判定 |",
    "|---|---|---|---|",
    `| 出齐三版率 | ${pct(s.shownRate)} | ≥ 90% | ${(s.shownRate ?? 0) >= 0.9 ? "通过" : "**未过**"} |`,
    `| 同一组有重复骨架的组数 | ${s.sameSkeletonGroups} | 0 | ${s.sameSkeletonGroups === 0 ? "通过" : "**未过**"} |`,
    `| 给了三版后仍追问的组数 | ${s.asksAfterDesigns} | 0 | ${s.asksAfterDesigns === 0 ? "通过" : "**未过**"} |`,
    `| 一页率 | ${pct(s.onePage)} | 100% | ${s.onePage === 1 ? "通过" : "**未过**"} |`,
    `| 内容零改动 | ${pct(s.contentUnchanged)} | 100% | ${s.contentUnchanged === 1 ? "通过" : "**未过**"} |`,
    `| 渲染干净（无盖住/隐藏/低对比/溢出） | ${pct(s.cleanRender)} | 100% | ${s.cleanRender === 1 ? "通过" : "**未过**"} |`,
    `| ATS 可读率 | ${pct(s.atsReadable)} | ≥ 95% | ${(s.atsReadable ?? 0) >= 0.95 ? "通过" : "**未过**"} |`,
    `| 恶意 CSS 拦截率 | ${pct(s.attackBlocked)}${s.attacksMissed.length ? `（漏：${s.attacksMissed.join("、")}）` : ""} | 100% | ${s.attackBlocked === 1 ? "通过" : "**未过**"} |`,
    `| 次轮与首轮重复的方向数（每次运行） | ${s.turn2RepeatsOfTurn1.join(",") || "—"} | 全 0 | ${s.turn2RepeatsOfTurn1.every((x) => x === 0) ? "通过" : "**未过**"} |`,
    "",
    "## 多样性",
    "",
    `- 同组三版的特征距离均值：${num(s.featureDistance)}（骨架、字体、抬头、标题样式、符号、技能、色相、装饰量共 9 项里不同的比例，越大越不撞）`,
    `- 同组三版缩略图的像素差均值：${num(s.imageDistance)}（0–1）`,
    `- 各场景首轮：${s.directionsPerScenario.map((d) => `${d.id} 共给 ${d.shown} 版、${d.distinct} 种方向`).join("；")}`,
    "",
    "## 设计标准量化（确定性：层级、对齐、留白、对比度各 1–5 分，4 个预设模板作对照）",
    "",
    s.aesthetic
      ? `- 生成版均分 ${num(s.aesthetic.generatedMean)}（层级 ${num(s.aesthetic.generatedByCriterion.hierarchy)} / 对齐 ${num(s.aesthetic.generatedByCriterion.alignment)} / 留白 ${num(s.aesthetic.generatedByCriterion.whitespace)} / 对比 ${num(s.aesthetic.generatedByCriterion.contrast)}）\n- 4 个预设模板均分 ${num(s.aesthetic.presetsMean)}：${s.aesthetic.presets.map((p) => `${p.template} ${num(p.overall)}`).join("、")}`
      : "（未评分）",
    "",
    s.vision
      ? s.vision.valid
        ? `- 看图评审（模型）均分 ${num(s.vision.mean)}`
        : "- 看图评审未采用：评审模型没通过看图金丝雀（DeepSeek 官方接口是纯文本，会瞎编），配置能看图的模型后再用 --vision-judge"
      : "- 看图评审未开（--vision-judge，需要能看图的评审模型）",
    "",
    `耗时：每组 p50 ${num(s.seconds.p50, 1)}s，最长 ${num(s.seconds.max, 1)}s；模型调用 ${s.usage.calls} 次，输入 ${s.usage.inputTokens} / 输出 ${s.usage.outputTokens} token`,
  ].join("\n");
}

await main();
