import {
  createFauxCore,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { applyCustomCss, applyThemePatch, DEFAULT_RESUME_STYLE, type ResumeStyle } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { createIntakeController } from "./controller.ts";
import { MAX_PREVIEWS } from "./style-tools.ts";
import { type CssSaveResult, createIntakeState, type IntakeEvent, type ResumeStyler } from "./types.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const GOOD_CSS =
  ".head { background: var(--accent); padding: 8mm } h2 { border-bottom: 0.75pt solid var(--accent) }";

function memory(options: { previewFails?: boolean } = {}) {
  let current: ResumeStyle = DEFAULT_RESUME_STYLE;
  let previews = 0;
  const styler: ResumeStyler = {
    async design(patch) {
      const change = applyThemePatch(current, patch);
      if (!change) throw new Error("样式参数不合法");
      current = change.style;
      return change;
    },
    async reset() {
      current = { template: current.template, accent: current.accent };
      return current;
    },
    async setCss(css): Promise<CssSaveResult> {
      if (css === null) {
        const { css: _c, ...rest } = current;
        current = rest;
        return { ok: true, style: current, rules: 0, dropped: [] };
      }
      const result = applyCustomCss(current, css);
      if (!result.ok) return result;
      current = result.style;
      return { ok: true, style: current, rules: result.rules, dropped: result.dropped };
    },
    async preview() {
      if (options.previewFails) throw new Error("浏览器没起来");
      previews++;
      return { png: PNG, check: { pages: previews === 1 ? 2 : 1, overflowX: 0, hiddenText: 0, overlaps: 0 } };
    },
  };
  return { styler, saved: () => current, previews: () => previews };
}

let n = 0;
const genId = (prefix: string) => `${prefix}_${++n}`;

function fake(steps: FauxResponseStep[], styles: ResumeStyler, seen: string[] = []) {
  const core = createFauxCore({ models: [{ id: "fake-model" }] });
  core.setResponses(steps);
  return createIntakeController({
    streamFn: (model, context, options) => {
      seen.push(JSON.stringify(context));
      return core.streamSimple(model, context, options);
    },
    model: core.getModel(),
    genId,
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
const image = { id: "img1", mimeType: "image/png" as const, data: "QUJD" };

describe("复刻参考图", () => {
  it("带图的一轮：保存、预览、再保存、再预览，最多 3 次预览，进度事件递增，结果图片回给模型", async () => {
    const { styler, saved, previews } = memory();
    const seen: string[] = [];
    const controller = fake(
      [
        toolTurn(fauxToolCall("set_resume_css", { css: GOOD_CSS })),
        toolTurn(fauxToolCall("preview_resume", {})),
        toolTurn(fauxToolCall("set_resume_css", { css: `${GOOD_CSS} .item-title { color: #111827 }` })),
        toolTurn(fauxToolCall("preview_resume", {})),
        toolTurn(fauxToolCall("preview_resume", {})),
        toolTurn(fauxToolCall("preview_resume", {})),
        fauxAssistantMessage([fauxText("复刻了色块抬头和标题下划线，字体和参考图还有差距。")]),
      ],
      styler,
      seen,
    );
    const state = createIntakeState();
    const events = await collect(
      controller.handleUserMessage(state, { id: "u1", text: "照这张图的风格做", images: [image] }),
    );

    expect(previews()).toBe(MAX_PREVIEWS);
    expect(saved().css).toContain(".item-title");
    const progress = events.filter((e) => e.type === "style_progress");
    expect(progress.map((e) => (e.type === "style_progress" ? `${e.stage}${e.round}` : ""))).toEqual([
      "styling1",
      "previewing1",
      "styling2",
      "previewing2",
      "previewing3",
    ]);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.filter((e) => e.type === "resume_style")).toHaveLength(2);

    const first = JSON.parse(seen[0] ?? "{}") as { messages: { role: string }[] };
    expect(JSON.stringify(first.messages.find((m) => m.role === "user"))).toContain("QUJD");
    const afterPreview = seen.find((s) => s.includes("第 1/3 次预览")) ?? "";
    expect(afterPreview).toContain('"type":"image"');

    const tools = state.history.at(-1)?.meta?.tools ?? [];
    expect(tools.map((t) => t.name)).toEqual([
      "set_resume_css",
      "preview_resume",
      "set_resume_css",
      "preview_resume",
      "preview_resume",
      "preview_resume",
    ]);
    expect(state.history.at(-2)).toMatchObject({ role: "user", meta: { images: [{ id: "img1" }] } });
    expect(state.facts).toEqual([]);
  });

  it("第 4 次预览被拒绝，不再渲染", async () => {
    const { styler, previews } = memory();
    const controller = fake(
      [
        toolTurn(fauxToolCall("set_resume_css", { css: GOOD_CSS })),
        toolTurn(fauxToolCall("preview_resume", {})),
        toolTurn(fauxToolCall("preview_resume", {})),
        toolTurn(fauxToolCall("preview_resume", {})),
        toolTurn(fauxToolCall("preview_resume", {})),
        fauxAssistantMessage([fauxText("好了。")]),
      ],
      styler,
    );
    const state = createIntakeState();
    await collect(controller.handleUserMessage(state, { id: "u1", text: "复刻", images: [image] }));
    expect(previews()).toBe(3);
    const last = state.history.at(-1)?.meta?.tools?.at(-1);
    expect(last?.result).toContain("不能再预览");
  });

  it("危险 CSS 被拒绝：样式不变，错误原因返回给模型，模型改正后保存成功", async () => {
    const { styler, saved } = memory();
    const controller = fake(
      [
        toolTurn(
          fauxToolCall("set_resume_css", { css: ".head { background: url(http://127.0.0.1:8000/x) }" }),
        ),
        toolTurn(fauxToolCall("set_resume_css", { css: GOOD_CSS })),
        fauxAssistantMessage([fauxText("改好了。")]),
      ],
      styler,
    );
    const state = createIntakeState();
    const events = await collect(
      controller.handleUserMessage(state, { id: "u1", text: "复刻", images: [image] }),
    );
    const tools = state.history.at(-1)?.meta?.tools ?? [];
    expect(tools[0]?.result).toContain("没有保存");
    expect(tools[0]?.result).toContain("url()");
    expect(tools[1]?.result).toContain("已保存定制 CSS");
    expect(saved().css).toBeDefined();
    expect(saved().css).not.toContain("127.0.0.1");
    expect(events.filter((e) => e.type === "resume_style")).toHaveLength(1);
  });

  it("预览渲染失败：保留已保存的样式，模型被告知不要再预览", async () => {
    const { styler, saved } = memory({ previewFails: true });
    const controller = fake(
      [
        toolTurn(fauxToolCall("set_resume_css", { css: GOOD_CSS })),
        toolTurn(fauxToolCall("preview_resume", {})),
        fauxAssistantMessage([fauxText("样式已保存，但没能预览对比。")]),
      ],
      styler,
    );
    const state = createIntakeState();
    const events = await collect(
      controller.handleUserMessage(state, { id: "u1", text: "复刻", images: [image] }),
    );
    expect(saved().css).toBeDefined();
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(state.history.at(-1)?.meta?.tools?.at(-1)?.result).toContain("预览渲染失败");
  });

  it("没有图片也没用过定制 CSS 时，不开放 CSS 工具、提示词也不提", async () => {
    const { styler } = memory();
    const seen: string[] = [];
    const controller = fake([fauxAssistantMessage([fauxText("好的。")])], styler, seen);
    await collect(controller.handleUserMessage(createIntakeState(), { id: "u1", text: "你好" }));
    expect(seen[0]).toContain("design_resume_style");
    expect(seen[0]).not.toContain("set_resume_css");
    expect(seen[0]).not.toContain("preview_resume");
  });

  it("下一轮回放历史：旧图片不再传整张，只留文字说明；上次的 CSS 还在工具记录里", async () => {
    const { styler } = memory();
    const seen: string[] = [];
    const controller = fake(
      [
        toolTurn(fauxToolCall("set_resume_css", { css: GOOD_CSS })),
        fauxAssistantMessage([fauxText("先做了一版。")]),
        fauxAssistantMessage([fauxText("好的，标题再大一点。")]),
      ],
      styler,
      seen,
    );
    const state = createIntakeState();
    await collect(controller.handleUserMessage(state, { id: "u1", text: "复刻", images: [image] }));
    seen.length = 0;
    await collect(controller.handleUserMessage(state, { id: "u2", text: "标题再大一点" }));
    const second = seen[0] ?? "";
    expect(second).not.toContain("QUJD");
    expect(second).not.toContain('"type":"image"');
    expect(second).toContain("张图片");
    expect(second).toContain("set_resume_css");
    expect(second).toContain("var(--accent)");
  });
});
