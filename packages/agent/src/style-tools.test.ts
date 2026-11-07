import {
  createFauxCore,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { applyThemePatch, DEFAULT_RESUME_STYLE, type ResumeStyle } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { computeCompleteness } from "./completeness.ts";
import { createIntakeController } from "./controller.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { TOOL_SPECS } from "./schemas.ts";
import { createIntakeState, type IntakeEvent, type ResumeStyler } from "./types.ts";

function memoryStyler(fail = false): { styler: ResumeStyler; saved: () => ResumeStyle } {
  let current: ResumeStyle = DEFAULT_RESUME_STYLE;
  return {
    saved: () => current,
    styler: {
      async design(patch) {
        if (fail) throw new Error("数据库不可用");
        const change = applyThemePatch(current, patch);
        if (!change) throw new Error("样式参数不合法");
        current = change.style;
        return change;
      },
      async reset() {
        current = { template: current.template, accent: current.accent };
        return current;
      },
    },
  };
}

let n = 0;
const genId = (prefix: string) => `${prefix}_${++n}`;

function fake(steps: FauxResponseStep[], styles?: ResumeStyler, prompts: string[] = []) {
  const core = createFauxCore({ models: [{ id: "fake-model" }] });
  core.setResponses(steps);
  return createIntakeController({
    streamFn: (model, context, options) => {
      prompts.push(JSON.stringify(context.messages.filter((m) => m.role === "system")));
      return core.streamSimple(model, context, options);
    },
    model: core.getModel(),
    genId,
    ...(styles && { styles }),
  });
}

async function collect(gen: AsyncGenerator<IntakeEvent, void>): Promise<IntakeEvent[]> {
  const events: IntakeEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

const toolTurn = (...calls: ReturnType<typeof fauxToolCall>[]) =>
  fauxAssistantMessage(calls, { stopReason: "toolUse" });

describe("design_resume_style", () => {
  it("把描述翻译成的字段校验后保存，发出 resume_style 事件，不写画像、不强行追问", async () => {
    const { styler, saved } = memoryStyler();
    const controller = fake(
      [
        toolTurn(
          fauxToolCall("design_resume_style", {
            name: "稳重深绿",
            accent: "#166534",
            headingFont: "serif",
            layout: "sidebar",
          }),
        ),
        fauxAssistantMessage([fauxText("换成了深绿两栏，标题用了宋体，样式已保存，你看看右边。")]),
      ],
      styler,
    );
    const state = createIntakeState();
    const events = await collect(
      controller.handleUserMessage(state, { id: "u1", text: "简历更稳重一点，标题用深绿，做成两栏" }),
    );

    expect(saved().theme).toMatchObject({ name: "稳重深绿", accent: "#166534", layout: "sidebar" });
    expect(events.find((e) => e.type === "resume_style")).toMatchObject({
      style: { template: "tech", theme: { accent: "#166534" } },
    });
    expect(state.facts).toEqual([]);
    expect(events.some((e) => e.type === "ask")).toBe(false);
    expect(events.some((e) => e.type === "error")).toBe(false);
    const tool = state.history.at(-1)?.meta?.tools?.[0];
    expect(tool).toMatchObject({ name: "design_resume_style" });
    expect(tool?.result).toContain("已保存简历样式");
    expect(tool?.result).toContain("样式按钮（调色板图标）");
    expect(tool?.result).toContain("网申");
  });

  it("太浅的颜色自动加深，并让模型如实说明", async () => {
    const { styler, saved } = memoryStyler();
    const controller = fake(
      [
        toolTurn(fauxToolCall("design_resume_style", { accent: "#fde047" })),
        fauxAssistantMessage([fauxText("换成了黄色系。")]),
      ],
      styler,
    );
    const state = createIntakeState();
    await collect(controller.handleUserMessage(state, { id: "u1", text: "主色换成明黄" }));
    expect(saved().theme?.accent).not.toBe("#fde047");
    expect(state.history.at(-1)?.meta?.tools?.[0]?.result).toContain("已加深为");
  });

  it("参数不合法时工具报错给模型修正，样式不变", async () => {
    const { styler, saved } = memoryStyler();
    const controller = fake(
      [
        toolTurn(fauxToolCall("design_resume_style", { accent: "url(http://10.0.0.1/)" })),
        toolTurn(fauxToolCall("design_resume_style", { accent: "#1e3a5f" })),
        fauxAssistantMessage([fauxText("换成了藏青色。")]),
      ],
      styler,
    );
    const state = createIntakeState();
    await collect(controller.handleUserMessage(state, { id: "u1", text: "换成藏青色" }));
    expect(saved().theme?.accent).toBe("#1e3a5f");
  });

  it("保存失败时告诉模型不能说已经改好", async () => {
    const { styler } = memoryStyler(true);
    const controller = fake(
      [
        toolTurn(fauxToolCall("design_resume_style", { layout: "single" })),
        fauxAssistantMessage([fauxText("这次没改成功，稍后再试试。")]),
      ],
      styler,
    );
    const state = createIntakeState();
    const events = await collect(controller.handleUserMessage(state, { id: "u1", text: "改成单栏" }));
    expect(events.some((e) => e.type === "resume_style")).toBe(false);
    expect(state.history.at(-1)?.meta?.tools?.[0]?.result).toContain("绝对不要说已经改好");
  });

  it("reset 清掉主题，回到预设模板", async () => {
    const { styler, saved } = memoryStyler();
    await styler.design({ accent: "#166534", layout: "sidebar" });
    const controller = fake(
      [
        toolTurn(fauxToolCall("design_resume_style", { reset: true })),
        fauxAssistantMessage([fauxText("已经换回来了。")]),
      ],
      styler,
    );
    const state = createIntakeState();
    const events = await collect(
      controller.handleUserMessage(state, { id: "u1", text: "还是换回原来的模板吧" }),
    );
    expect(saved().theme).toBeUndefined();
    expect(events.find((e) => e.type === "resume_style")).toMatchObject({ style: { template: "tech" } });
  });

  it("没注入样式能力时不开放工具，提示词里也不提", async () => {
    const prompts: string[] = [];
    const controller = fake([fauxAssistantMessage([fauxText("你好，怎么称呼你？")])], undefined, prompts);
    await collect(controller.handleUserMessage(createIntakeState(), { id: "u1", text: "你好" }));
    expect(prompts.join("")).not.toContain("design_resume_style");

    const state = createIntakeState();
    const prompt = buildSystemPrompt({
      profile: state.profile,
      completeness: computeCompleteness(state.profile),
      slot: null,
      completedSections: [],
      conflicts: [],
      styleTool: true,
    });
    expect(prompt).not.toContain("## 简历样式");
    expect(prompt).not.toContain("design_resume_style");
    expect(TOOL_SPECS.find((s) => s.name === "design_resume_style")?.description).toContain("更稳重一点");
  });
});
