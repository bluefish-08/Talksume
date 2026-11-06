import {
  createFauxCore,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { DEFAULT_RESUME_STYLE, directionById, styleFromDesign, styleFromDirection } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { createIntakeController } from "./controller.ts";
import { MAX_PROPOSALS } from "./style-tools.ts";
import {
  createIntakeState,
  type DesignOption,
  type IntakeEvent,
  type ResumeStyler,
  type StylePreviewCheck,
} from "./types.ts";

const CLEAN: StylePreviewCheck = { pages: 1, overflowX: 0, hiddenText: 0, overlaps: 0 };
const THUMB = `data:image/jpeg;base64,${Buffer.from([1, 2, 3]).toString("base64")}`;

const LOOKS = [
  { accent: "#1e3a5f", bodyFont: "serif", headingFont: "serif", header: "rule", headingStyle: "underline" },
  { accent: "#1f5f4a", bodyFont: "sans", headingFont: "sans", header: "band", headingStyle: "block" },
  { accent: "#8c2f39", bodyFont: "sans", headingFont: "serif", header: "plain", headingStyle: "bar" },
];
let looks = 0;
const theme = (name: string, skeleton: string) => ({
  name,
  ...LOOKS[looks++ % LOOKS.length],
  headerAlign: "left",
  layout: "single",
  skeleton,
  bullet: "dot",
  skills: "line",
  density: "auto",
});
const design = (name: string, skeleton: string) => ({
  summary: `${name}的气质`,
  theme: theme(name, skeleton),
});

let unreadable: string[] = [];
const atsOf = (key: string) =>
  unreadable.includes(key) ? { ok: false, issues: ["栏间文字交错"] } : { ok: true, issues: [] };

function stylerWith(check: StylePreviewCheck = CLEAN, recent: string[] = []) {
  const calls: unknown[][] = [];
  const styler: ResumeStyler = {
    async design() {
      return { style: DEFAULT_RESUME_STYLE, notes: [] };
    },
    async reset() {
      return DEFAULT_RESUME_STYLE;
    },
    async recentDirections() {
      return recent;
    },
    async propose(designs) {
      calls.push(designs);
      const options: DesignOption[] = [];
      const rejected: { index: number; errors: string[] }[] = [];
      designs.forEach((d, index) => {
        const direction = d.direction ? directionById(d.direction) : undefined;
        const built = direction ? styleFromDirection(direction) : styleFromDesign(d.theme, d.css);
        if (!built.ok) rejected.push({ index, errors: built.errors });
        else
          options.push({
            id: `o${index}`,
            ...(direction && { direction: direction.id }),
            name: built.style.theme?.name ?? "",
            summary: d.summary ?? "",
            style: built.style,
            thumbnail: THUMB,
            check,
            ats: atsOf(d.direction ?? built.style.theme?.name ?? ""),
          });
      });
      return { options, rejected };
    },
  };
  return { styler, calls };
}

let n = 0;
function fake(steps: FauxResponseStep[], styles: ResumeStyler, seen: string[] = []) {
  const core = createFauxCore({ models: [{ id: "fake-model" }] });
  core.setResponses(steps);
  return createIntakeController({
    streamFn: (model, context, options) => {
      seen.push(JSON.stringify(context));
      return core.streamSimple(model, context, options);
    },
    model: core.getModel(),
    genId: (prefix) => `${prefix}_${++n}`,
    styles,
  });
}

async function collect(gen: AsyncGenerator<IntakeEvent, void>) {
  const events: IntakeEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

const toolTurn = (...calls: ReturnType<typeof fauxToolCall>[]) =>
  fauxAssistantMessage(calls, { stopReason: "toolUse" });
const three = [design("沉稳蓝", "side-left"), design("清新绿", "timeline"), design("设计感", "numbered")];
// 有候选方向时，第一次自己拼的主题会被挡回（不渲染、不占提交次数）
const STEER = toolTurn(fauxToolCall("propose_resume_designs", { designs: three }));

describe("一次出 3 版", () => {
  it("三版合格：发 style_options、落进 meta.designs，不保存样式，缩略图回给模型", async () => {
    const { styler } = stylerWith();
    const seen: string[] = [];
    const controller = fake(
      [
        STEER,
        toolTurn(fauxToolCall("propose_resume_designs", { designs: three })),
        fauxAssistantMessage([fauxText("三版各有气质，点一个试试。")]),
      ],
      styler,
      seen,
    );
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "u1", text: "帮我设计一下" }));

    const shown = events.find((e) => e.type === "style_options");
    expect(shown && shown.type === "style_options" ? shown.options.map((o) => o.name) : []).toEqual([
      "沉稳蓝",
      "清新绿",
      "设计感",
    ]);
    expect(events.some((e) => e.type === "resume_style")).toBe(false);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(state.history.at(-1)?.meta?.designs).toHaveLength(3);
    expect(seen.filter((s) => s.includes('"type":"image"')).length).toBeGreaterThan(0);
    expect(state.history.at(-1)?.meta?.tools?.map((t) => t.name)).toEqual([
      "propose_resume_designs",
      "propose_resume_designs",
    ]);
  });

  it("骨架重复：第一次不展示，修好后第二次展示；最多提交两次", async () => {
    const { styler, calls } = stylerWith();
    const dup = [design("甲", "cards"), design("乙", "cards"), design("丙", "timeline")];
    const controller = fake(
      [
        STEER,
        toolTurn(fauxToolCall("propose_resume_designs", { designs: dup })),
        toolTurn(fauxToolCall("propose_resume_designs", { designs: three })),
        toolTurn(fauxToolCall("propose_resume_designs", { designs: three })),
        fauxAssistantMessage([fauxText("好了。")]),
      ],
      styler,
    );
    const events = await collect(
      controller.handleUserMessage(createIntakeState(), { id: "u1", text: "来几个版式" }),
    );
    expect(calls).toHaveLength(MAX_PROPOSALS);
    const shown = events.filter((e) => e.type === "style_options");
    expect(shown).toHaveLength(1);
    expect(shown[0]?.type === "style_options" ? shown[0].options.map((o) => o.name) : []).toEqual([
      "沉稳蓝",
      "清新绿",
      "设计感",
    ]);
  });

  it("三版展示后模型顺带追问的问句不送出，介绍里的版本名来自展示的那几版", async () => {
    const { styler } = stylerWith();
    const seen: string[] = [];
    const controller = fake(
      [
        STEER,
        toolTurn(fauxToolCall("propose_resume_designs", { designs: three })),
        fauxAssistantMessage([fauxText("三版都出来了，点一个试试。这段实习主要用了哪些技术栈？")]),
      ],
      styler,
      seen,
    );
    const events = await collect(
      controller.handleUserMessage(createIntakeState(), { id: "u1", text: "帮我设计一下" }),
    );
    const said = events.flatMap((e) => (e.type === "token" ? [e.text] : [])).join("");
    expect(said).toContain("点一个试试");
    expect(said).not.toContain("技术栈");
    expect(seen.join("")).toContain("展示给用户的版本");
  });

  it("最后一次仍只有两版：系统从方向库补到三版，骨架各不相同", async () => {
    const { styler, calls } = stylerWith();
    const dup = [design("甲", "cards"), design("乙", "cards"), design("丙", "timeline")];
    const controller = fake(
      [
        STEER,
        toolTurn(fauxToolCall("propose_resume_designs", { designs: dup })),
        toolTurn(fauxToolCall("propose_resume_designs", { designs: dup })),
        fauxAssistantMessage([fauxText("好了。")]),
      ],
      styler,
    );
    const events = await collect(
      controller.handleUserMessage(createIntakeState(), { id: "u1", text: "来几个版式" }),
    );
    expect(calls).toHaveLength(MAX_PROPOSALS + 1);
    const shown = events.filter((e) => e.type === "style_options");
    expect(shown).toHaveLength(1);
    const options = shown[0]?.type === "style_options" ? shown[0].options : [];
    expect(options).toHaveLength(3);
    expect(new Set(options.map((o) => o.style.theme?.skeleton)).size).toBe(3);
  });

  it("有版本被拒绝：第一次提交不展示，也不落库", async () => {
    const { styler } = stylerWith();
    const bad = { summary: "坏的一版", theme: { name: "坏" } };
    const mixed = [design("沉稳蓝", "side-left"), design("清新绿", "timeline"), bad];
    const controller = fake(
      [
        toolTurn(fauxToolCall("propose_resume_designs", { designs: mixed })),
        fauxAssistantMessage([fauxText("好了。")]),
      ],
      styler,
    );
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "u1", text: "换个好看的" }));
    expect(events.some((e) => e.type === "style_options")).toBe(false);
    expect(state.history.at(-1)?.meta?.designs).toBeUndefined();
  });

  it("用方向库：三个方向 id 即可，提示里有候选，缩略图后不追问、不出 ask", async () => {
    const { styler } = stylerWith();
    const seen: string[] = [];
    const controller = fake(
      [
        toolTurn(
          fauxToolCall("propose_resume_designs", {
            designs: [
              { direction: "classic-broadsheet" },
              { direction: "side-left-navy" },
              { direction: "timeline-square", accent: "#0f766e" },
            ],
          }),
        ),
        toolTurn(fauxToolCall("ask_user", { question: "你想要哪个城市？" })),
        fauxAssistantMessage([fauxText("三版各有气质，点一个。")]),
      ],
      styler,
      seen,
    );
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "u1", text: "来几个稳重的版式" }));
    expect(seen[0]).toContain("本轮候选");
    expect(seen[0]).toContain("direction");
    const shown = events.find((e) => e.type === "style_options");
    expect(shown && shown.type === "style_options" ? shown.options.map((o) => o.direction) : []).toEqual([
      "classic-broadsheet",
      "side-left-navy",
      "timeline-square",
    ]);
    expect(events.some((e) => e.type === "ask")).toBe(false);
    expect(state.history.at(-1)?.meta?.designs).toHaveLength(3);
  });

  it("用户见过的方向第一次提交被换掉；同骨架的后一版被拒", async () => {
    const { styler, calls } = stylerWith(CLEAN, ["side-left-navy"]);
    const controller = fake(
      [
        toolTurn(
          fauxToolCall("propose_resume_designs", {
            designs: [
              { direction: "classic-broadsheet" },
              { direction: "side-left-navy" },
              { direction: "classic-airy" },
            ],
          }),
        ),
        toolTurn(
          fauxToolCall("propose_resume_designs", {
            designs: [
              { direction: "classic-broadsheet" },
              { direction: "side-left-bright" },
              { direction: "timeline-square" },
            ],
          }),
        ),
        fauxAssistantMessage([fauxText("好了。")]),
      ],
      styler,
    );
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "u1", text: "换个好看的" }));
    expect(calls).toHaveLength(2);
    const shown = events.filter((e) => e.type === "style_options");
    expect(shown).toHaveLength(1);
    expect(shown[0]?.type === "style_options" ? shown[0].options.map((o) => o.direction) : []).toEqual([
      "classic-broadsheet",
      "side-left-bright",
      "timeline-square",
    ]);
  });

  it("某版网申读不全：工具结果里让模型提醒用户并指向读得全的那版", async () => {
    unreadable = ["side-left-navy"];
    const { styler } = stylerWith();
    const seen: string[] = [];
    const controller = fake(
      [
        toolTurn(
          fauxToolCall("propose_resume_designs", {
            designs: [
              { direction: "classic-broadsheet" },
              { direction: "side-left-navy" },
              { direction: "timeline-square" },
            ],
          }),
        ),
        fauxAssistantMessage([fauxText("好了。")]),
      ],
      styler,
      seen,
    );
    await collect(controller.handleUserMessage(createIntakeState(), { id: "u1", text: "来几个版式" }));
    unreadable = [];
    const toolResult = seen.find((x) => x.includes("网申系统可能读不全")) ?? "";
    expect(toolResult).toContain("栏间文字交错");
    expect(toolResult).toContain("投网申建议换用");
  });
});
