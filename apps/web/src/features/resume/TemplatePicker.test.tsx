import { DEFAULT_RESUME_STYLE, type ResumeStyle, TEMPLATE_INFO } from "@talksume/core";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeContent } from "../../api/types.ts";
import {
  applyResumeStyleDesign,
  deleteResumeStyleDesign,
  type ResumeStyleDesign,
  STYLE_ASK_MESSAGE,
} from "./queries.ts";
import { StylePanel, type StylePanelProps, styleLabel } from "./TemplatePicker.tsx";

vi.mock("./ResumePreview.tsx", () => ({ ResumePreview: () => null }));

const resume: ResumeContent = {
  basics: { name: "李明", contacts: [] },
  sections: [],
};

const customStyle: ResumeStyle = {
  template: "modern",
  accent: "blue",
  theme: {
    name: "清爽蓝",
    accent: "#2563eb",
    bodyFont: "sans",
    headingFont: "sans",
    header: "plain",
    headerAlign: "left",
    headingStyle: "underline",
    layout: "single",
    bullet: "dot",
    skills: "line",
    density: "auto",
  },
};

const design: ResumeStyleDesign = {
  id: "d1",
  name: "清爽蓝",
  style: customStyle,
  createdAt: "2026-10-01T00:00:00.000Z",
};

const baseProps: StylePanelProps = {
  resume,
  style: DEFAULT_RESUME_STYLE,
  designs: [],
  currentId: null,
  onPickTemplate: () => {},
  onPickAccent: () => {},
  onApplyDesign: () => {},
  onDeleteDesign: () => {},
  onAskAi: () => {},
};

type ButtonProps = {
  children?: ReactNode;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
  "aria-description"?: string;
  className?: string;
};

function collectButtons(node: ReactNode, out: ReactElement<ButtonProps>[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const element = node as ReactElement<ButtonProps>;
  if (element.type === "button") out.push(element);
  collectButtons(element.props.children, out);
  return out;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!isValidElement(node)) return "";
  return textOf((node.props as { children?: ReactNode }).children);
}

function findButton(element: ReactElement, match: (button: ReactElement<ButtonProps>) => boolean) {
  const button = collectButtons(element).find(match);
  if (!button) throw new Error("button not found");
  return button;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("简历样式面板", () => {
  it("没有设计时不显示我的设计；预设模板和再设计入口还在", () => {
    const html = renderToStaticMarkup(<StylePanel {...baseProps} />);
    expect(html).not.toContain("我的设计");
    expect(html).toContain("预设模板");
    expect(html).toContain("让 AI 再设计几版");
    expect(html).not.toContain("智能推荐");
  });

  it("按当前设计标出勾选，名字在缩略图下方", () => {
    const html = renderToStaticMarkup(<StylePanel {...baseProps} designs={[design]} currentId={design.id} />);
    expect(html).toContain("我的设计");
    expect(html).toContain("清爽蓝");
    expect(html).toContain('aria-label="应用设计「清爽蓝」"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-current="true"');
    expect(html).not.toContain('aria-label="删除设计「清爽蓝」"');
  });

  it("选预设样式时历史仍在，不会顺手删掉", () => {
    const onPickTemplate = vi.fn();
    const onDeleteDesign = vi.fn();
    const tree = StylePanel({
      ...baseProps,
      designs: [design],
      currentId: null,
      onPickTemplate,
      onDeleteDesign,
    });
    expect(renderToStaticMarkup(tree)).toContain("清爽蓝");
    expect(renderToStaticMarkup(tree)).toContain('aria-label="删除设计「清爽蓝」"');
    const preset = findButton(tree, (button) => button.props["aria-label"] === "使用模板「现代强调色」");
    const designButton = findButton(tree, (button) => button.props["aria-label"] === "应用设计「清爽蓝」");
    expect(preset.props.className).toBe(designButton.props.className);
    expect(preset.props.title).toBe(TEMPLATE_INFO.modern.hint);
    expect(preset.props["aria-description"]).toBe(TEMPLATE_INFO.modern.hint);
    expect(textOf(preset)).toBe("现代强调色");
    expect(textOf(preset)).not.toContain(TEMPLATE_INFO.modern.hint);
    preset.props.onClick?.();
    expect(onPickTemplate).toHaveBeenCalledWith("modern");
    expect(onDeleteDesign).not.toHaveBeenCalled();
  });

  it("点设计应用、删除和让 AI 再设计几版分别走对应回调", () => {
    const onApplyDesign = vi.fn();
    const onDeleteDesign = vi.fn();
    const onAskAi = vi.fn();
    const tree = StylePanel({
      ...baseProps,
      designs: [design],
      currentId: null,
      onApplyDesign,
      onDeleteDesign,
      onAskAi,
    });
    findButton(tree, (button) => button.props["aria-label"] === "应用设计「清爽蓝」").props.onClick?.();
    expect(onApplyDesign).toHaveBeenCalledWith("d1");
    findButton(tree, (button) => button.props["aria-label"] === "删除设计「清爽蓝」").props.onClick?.();
    expect(onDeleteDesign).toHaveBeenCalledWith("d1");
    findButton(tree, (button) => textOf(button).includes("让 AI 再设计几版")).props.onClick?.();
    expect(onAskAi).toHaveBeenCalledTimes(1);
  });

  it("流式回复中再设计按钮禁用并说明原因", () => {
    const onAskAi = vi.fn();
    const tree = StylePanel({ ...baseProps, onAskAi, askAiDisabled: true });
    const button = findButton(tree, (item) => textOf(item).includes("让 AI 再设计几版"));
    expect(button.props.disabled).toBe(true);
    expect(button.props.title).toBe("等这条回复完再试");
    expect(button.props["aria-description"]).toBe("等这条回复完再试");
    button.props.onClick?.();
    expect(onAskAi).not.toHaveBeenCalled();
  });

  it("触发器的文案：定制样式用主题名，预设用模板名", () => {
    expect(styleLabel(customStyle)).toBe("清爽蓝");
    expect(styleLabel(customStyle)).not.toContain("AI 定制");
    expect(styleLabel(DEFAULT_RESUME_STYLE)).toBe(TEMPLATE_INFO.campus.label);
  });

  it("应用设计确实是 POST 到接口，删除是 DELETE", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ style: customStyle }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await applyResumeStyleDesign("d1")).toMatchObject({ theme: { name: "清爽蓝" } });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/resume/style/designs/d1/apply",
      expect.objectContaining({ method: "POST" }),
    );
    await deleteResumeStyleDesign("d2");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/resume/style/designs/d2",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("再设计消息固定为约定的那句话", () => {
    expect(STYLE_ASK_MESSAGE).toBe("帮我再设计几版简历样式");
  });
});
