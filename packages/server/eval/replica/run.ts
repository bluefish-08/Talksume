// 复刻评测：对每张参考图跑一遍真实的对话流程，统计轮数、相似度、内容零改动。
//   node --env-file=/path/to/.env eval/replica/run.ts --out eval-out/replica [--only id1,id2] [--jobs 2] [--thinking]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIntakeController, createIntakeState, type IntakeEvent } from "@talksume/agent";
import { clearCustomCss } from "@talksume/core";
import { createGateway, loadGatewayConfig } from "@talksume/llm-gateway";
import { close, htmlToPng, renderResumePng } from "@talksume/resume-render";
import { imageNotes } from "../../src/image-notes.ts";
import { evalResume } from "./fixture.ts";
import { decode, similarity } from "./metrics.ts";
import { REFS } from "./refs.ts";
import { memoryStyler } from "./styler.ts";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const outBase = resolve(arg("out") ?? "eval-out/replica");
const only = arg("only")?.split(",");
const jobs = Number(arg("jobs") ?? 2);
const thinking = flag("thinking");
const MODEL = process.env.EVAL_MODEL || "deepseek-flash";
const USER_TEXT = arg("text") ?? "帮我照着这张图的样式做我的简历";

const config = loadGatewayConfig(process.env, { model: MODEL, fallbackModel: MODEL });
const gateway = createGateway(config);

// 两栏会改变 DOM 顺序，所以只比较字符多重集，不比较顺序
const sameContent = (a: string, b: string) =>
  [...a.replace(/\s/g, "")].sort().join("") === [...b.replace(/\s/g, "")].sort().join("");

const JUDGE_PROMPT = `你是简历版式评审。第一张是参考模板图，第二张是复刻结果（文字内容不同可以忽略，只比较样式）。
按 1–10 分给出这几项的相似度：color（主色和配色）、layout（单双栏、整体版式、留白）、header（抬头结构）、headings（分区标题样式）、decor（图标、分隔线、色块、标签等装饰）、overall（整体观感）。
只输出 JSON：{"color":n,"layout":n,"header":n,"headings":n,"decor":n,"overall":n,"diff":"最明显的差距，一句话"}`;

async function judge(ref: Uint8Array, rep: Uint8Array) {
  const messages = [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: JUDGE_PROMPT },
        { type: "image" as const, data: Buffer.from(ref).toString("base64"), mimeType: "image/png" },
        { type: "image" as const, data: Buffer.from(rep).toString("base64"), mimeType: "image/png" },
      ],
      timestamp: Date.now(),
    },
  ];
  try {
    const { text } = await gateway.complete({
      purpose: "eval.replica.judge",
      messages,
      thinking: false,
      maxTokens: 400,
    });
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as Record<string, number | string>;
    return json;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const b64 = (b: Uint8Array) => `data:image/png;base64,${Buffer.from(b).toString("base64")}`;
const compareHtml = (id: string, ref: Uint8Array, rep: Uint8Array, note: string) =>
  `<body style="margin:0;background:#f3f4f6;font:14px sans-serif;width:1700px"><div style="padding:10px 16px;font-weight:700">${id}　${note}</div>
<div style="display:flex;gap:16px;padding:0 16px 16px;align-items:flex-start"><div><div style="margin:4px 0">参考图</div><img style="width:820px;border:1px solid #ccc" src="${b64(ref)}"></div>
<div><div style="margin:4px 0">复刻结果</div><img style="width:820px;border:1px solid #ccc" src="${b64(rep)}"></div></div></body>`;

interface Result {
  id: string;
  title: string;
  rounds: number;
  saves: number;
  rejectedCss: number;
  ms: number;
  saved: boolean;
  contentSame: boolean;
  hiddenText: number;
  pages: number;
  sim: ReturnType<typeof similarity>;
  judge: Record<string, number | string>;
  reply: string;
  error?: string;
  css?: string | undefined;
  rejections: string[];
  trace: string[];
}

async function runOne(ref: (typeof REFS)[number]): Promise<Result> {
  const started = Date.now();
  const refPng = readFileSync(join(here, "refs", `${ref.id}.png`));
  const { styler, style, rejected } = memoryStyler();
  const controller = createIntakeController({
    streamFn: gateway.streamFn("eval.replica", { thinking }),
    model: gateway.primaryModel,
    styles: styler,
  });
  const state = createIntakeState();
  const events: IntakeEvent[] = [];
  const image = { id: ref.id, mimeType: "image/png" as const, data: refPng.toString("base64") };
  const notes = flag("no-palette") ? [] : await imageNotes([image]);
  let reply = "";
  let error: string | undefined;
  for await (const e of controller.handleUserMessage(state, {
    id: `m_${ref.id}`,
    text: USER_TEXT,
    images: [image],
    ...(notes.length > 0 && { imageNotes: notes }),
  })) {
    events.push(e);
    if (e.type === "token") reply += e.text;
    if (e.type === "error") error = e.message;
  }
  const tools = state.history.at(-1)?.meta?.tools ?? [];
  const rounds = tools.filter((t) => t.name === "preview_resume" && !t.result.includes("不能再预览")).length;
  const final = style();
  const rep = await renderResumePng(evalResume, final);
  // 基线是同一套主题、去掉定制 CSS：主题本身（如技能标签）会改文字分隔，不算 CSS 改了内容
  const plain = await renderResumePng(evalResume, clearCustomCss(final));
  const sim = similarity(decode(refPng), decode(rep.png));
  const judged = await judge(refPng, rep.png);
  mkdirSync(outBase, { recursive: true });
  writeFileSync(join(outBase, `${ref.id}.replica.png`), rep.png);
  writeFileSync(
    join(outBase, `${ref.id}.compare.png`),
    await htmlToPng(
      compareHtml(
        ref.id,
        refPng,
        rep.png,
        `${rounds} 轮预览 · 版式 ${sim.layout} · 评审 ${judged.overall ?? "-"}/10`,
      ),
    ),
  );
  return {
    id: ref.id,
    title: ref.title,
    rounds,
    saves: tools.filter((t) => t.name === "set_resume_css" && t.result.startsWith("已保存")).length,
    rejectedCss: rejected().length,
    ms: Date.now() - started,
    saved: Boolean(final.css),
    contentSame: sameContent(rep.check.text, plain.check.text),
    hiddenText: rep.check.hiddenText,
    pages: rep.check.pages,
    sim,
    judge: judged,
    reply: reply.trim().slice(0, 300),
    ...(error && { error }),
    css: final.css,
    rejections: rejected(),
    trace: tools.map(
      (t) =>
        `${t.name}${t.name === "set_resume_css" ? (t.result.startsWith("已保存") ? ":ok" : ":rejected") : ""}`,
    ),
  };
}

const todo = REFS.filter((r) => !only || only.includes(r.id));
const results: Result[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(jobs, todo.length) }, async () => {
    while (next < todo.length) {
      const ref = todo[next++] as (typeof REFS)[number];
      try {
        const r = await runOne(ref);
        results.push(r);
        console.log(
          `${r.id}: rounds=${r.rounds} layout=${r.sim.layout} judge=${r.judge.overall} same=${r.contentSame} ${Math.round(r.ms / 1000)}s${r.error ? ` ERROR ${r.error}` : ""}`,
        );
      } catch (error) {
        console.log(`${ref.id}: FAILED ${error instanceof Error ? error.message : error}`);
      }
    }
  }),
);
await close();

const mean = (xs: number[]) =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0;
const num = (v: number | string | undefined) => (typeof v === "number" ? v : Number.NaN);
const judged = results.map((r) => num(r.judge.overall)).filter((v) => !Number.isNaN(v));
const summary = {
  n: results.length,
  model: MODEL,
  thinking,
  meanRounds: mean(results.map((r) => r.rounds)),
  savedRate: mean(results.map((r) => (r.saved ? 100 : 0))),
  meanLayout: mean(results.map((r) => r.sim.layout)),
  meanJudgeOverall: mean(judged),
  contentSameRate: mean(results.map((r) => (r.contentSame && r.hiddenText === 0 ? 100 : 0))),
  onePageRate: mean(results.map((r) => (r.pages === 1 ? 100 : 0))),
  meanSeconds: mean(results.map((r) => r.ms / 1000)),
};
writeFileSync(`${outBase}.json`, JSON.stringify({ summary, results }, null, 2));
const row = (r: Result) =>
  `| ${r.id} | ${r.rounds} | ${r.saves}/${r.rejectedCss} | ${r.sim.layout} | ${r.judge.overall ?? "-"} | ${r.contentSame && r.hiddenText === 0 ? "✓" : "✗"} | ${r.pages} | ${Math.round(r.ms / 1000)} | ${String(r.judge.diff ?? "").replace(/\|/g, "/")} |`;
writeFileSync(
  `${outBase}.md`,
  `# 复刻评测\n\n${JSON.stringify(summary)}\n\n| 参考图 | 预览轮数 | 保存/被拒 | 版式 | 评审 | 内容不变 | 页数 | 秒 | 评审指出的差距 |\n|---|---|---|---|---|---|---|---|---|\n${results.map(row).join("\n")}\n`,
);
console.log(JSON.stringify(summary));
