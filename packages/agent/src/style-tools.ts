import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent, TSchema } from "@earendil-works/pi-ai";
import { describeTheme, TEMPLATE_INFO } from "@talksume/core";
import type { z } from "zod";
import { DesignResumeStyleArgs, PreviewResumeArgs, SetResumeCssArgs } from "./schemas.ts";
import { type RunContext, text, tool } from "./tools.ts";
import type { ResumeStyler, StylePreviewCheck, ToolRecord } from "./types.ts";

const SAVED_NOTE =
  "右侧预览已经换成这套样式，导出 PDF 也会按它来；只改了外观，简历内容没动。用一两句话告诉用户改了哪些地方，请用户看看右边的预览，不满意可以接着说想怎么调，也可以在简历上方的样式下拉里换回预设模板。";

const SIDEBAR_NOTE = "两栏版式在部分网申系统（ATS）里可能读乱，顺带提醒一句：投大厂网申时可以换回单栏。";

const FAILED_NOTE =
  "如实告诉用户这次样式没改成功，可以稍后再试，或在简历上方的样式下拉里手动换模板；绝对不要说已经改好。";

/** 复刻参考图时最多让模型看几次自己的渲染结果。 */
export const MAX_PREVIEWS = 3;
/** 一轮对话里复刻流程的总时间预算，超过后不再截图。 */
export const REPLICA_BUDGET_MS = 150_000;

function checkLines(check: StylePreviewCheck): string[] {
  return [
    check.pages > 1 ? `内容现在有 ${check.pages} 页，应压到一页：收紧间距、字号或装饰的占高。` : "",
    check.overflowX > 0 ? `有 ${check.overflowX} 处内容超出纸面右边缘，请缩小宽度或边距。` : "",
    check.hiddenText > 0 ? `有 ${check.hiddenText} 处文字看不见，检查是否被装饰盖住或尺寸为 0。` : "",
    (check.lowContrast ?? 0) > 0
      ? `有 ${check.lowContrast} 处文字和底色对比太弱（深字落在深底上或浅字落在浅底上），给该区域内的文字单独指定能看清的颜色。`
      : "",
    check.overlaps > 0 ? `有 ${check.overlaps} 处文字块互相重叠，检查绝对定位和负边距。` : "",
  ].filter(Boolean);
}

/** 样式工具不写画像，算旁支任务：这一轮不强制追问、不触发收尾。 */
export function createStyleTools(
  ctx: RunContext,
  styler: ResumeStyler,
  log: ToolRecord[],
  options: { replica?: boolean; now?: () => number } = {},
): AgentTool<TSchema>[] {
  const now = options.now ?? Date.now;
  const startedAt = now();
  let previews = 0;

  async function work(args: z.infer<typeof DesignResumeStyleArgs>): Promise<string> {
    if (args.reset) {
      const style = await styler.reset();
      ctx.emit({ type: "resume_style", style });
      ctx.flags.styled = true;
      return `已恢复为预设模板「${TEMPLATE_INFO[style.template].label}」，预览和导出都回到预设样式。告诉用户已经换回来了。`;
    }
    const { reset: _reset, ...patch } = args;
    if (Object.values(patch).every((v) => v === undefined)) {
      return "没有给出任何要改的样式字段，样式没变。先问用户想怎么调（颜色、字体、单栏还是两栏、疏密），不要说已经改好。";
    }
    if (options.replica)
      ctx.emit({ type: "style_progress", stage: "styling", round: previews + 1, max: MAX_PREVIEWS });
    const { style, notes } = await styler.design(patch);
    const theme = style.theme;
    if (!theme) throw new Error("样式没有保存成功");
    ctx.emit({ type: "resume_style", style });
    ctx.flags.styled = true;
    return [
      `已保存简历样式：${describeTheme(theme)}。`,
      ...notes.map((n) => `${n}，要向用户说明。`),
      SAVED_NOTE,
      theme.layout === "sidebar" ? SIDEBAR_NOTE : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const designResumeStyle = tool(
    "design_resume_style",
    "定制简历样式",
    DesignResumeStyleArgs,
    async (args: z.infer<typeof DesignResumeStyleArgs>) => {
      let result: string;
      try {
        result = await work(args);
      } catch (error) {
        result = `保存简历样式失败：${error instanceof Error ? error.message : String(error)}。${FAILED_NOTE}`;
      }
      ctx.flags.jobs = true;
      log.push({ name: "design_resume_style", args: JSON.parse(JSON.stringify(args)), result });
      return text(result);
    },
  );

  const tools = [designResumeStyle];
  const { setCss, preview } = styler;
  if (!setCss || !preview || !options.replica) return tools;

  async function saveCss(args: z.infer<typeof SetResumeCssArgs>): Promise<{ text: string; ok: boolean }> {
    if (args.clear) {
      const result = await setCss?.(null);
      if (result?.ok) ctx.emit({ type: "resume_style", style: result.style });
      return { text: "已去掉定制 CSS，只保留主题样式。", ok: true };
    }
    if (!args.css?.trim()) return { text: "没有给出 css，样式没变。", ok: false };
    ctx.emit({
      type: "style_progress",
      stage: "styling",
      round: Math.min(previews + 1, MAX_PREVIEWS),
      max: MAX_PREVIEWS,
    });
    const result = await setCss?.(args.css);
    if (!result?.ok) {
      const errors = result?.errors ?? ["保存失败"];
      return {
        ok: false,
        text: `定制 CSS 没有保存（上一版样式继续有效）：\n${errors.map((e) => `- ${e}`).join("\n")}\n按上面的原因修改后重新调用 set_resume_css，传完整的一份；改不动的效果换个写法或放弃，不要硬凑。`,
      };
    }
    ctx.emit({ type: "resume_style", style: result.style });
    ctx.flags.styled = true;
    const next =
      previews < MAX_PREVIEWS
        ? `接下来调用 preview_resume 看渲染结果，并和参考图对比（还剩 ${MAX_PREVIEWS - previews} 次预览）。`
        : "预览次数已用完，不要再调用 preview_resume，直接向用户说明复刻了什么、还有哪些差距。";
    const dropped =
      result.dropped.length > 0
        ? `\n下面这些规则不合规，已丢弃（其余已保存）：\n${result.dropped.map((d) => `- ${d}`).join("\n")}\n还想要这些效果的话，换成支持的写法后重新保存完整的一份。`
        : "";
    return {
      ok: true,
      text: `已保存定制 CSS（${result.rules} 条规则）。右侧预览和导出 PDF 都会按它来；只改了外观，简历内容没动。${dropped}\n${next}`,
    };
  }

  const setResumeCss = tool(
    "set_resume_css",
    "定制简历 CSS",
    SetResumeCssArgs,
    async (args: z.infer<typeof SetResumeCssArgs>) => {
      let result: { text: string; ok: boolean };
      try {
        result = await saveCss(args);
      } catch (error) {
        result = {
          ok: false,
          text: `保存定制 CSS 失败：${error instanceof Error ? error.message : String(error)}。${FAILED_NOTE}`,
        };
      }
      ctx.flags.jobs = true;
      log.push({ name: "set_resume_css", args: JSON.parse(JSON.stringify(args)), result: result.text });
      return text(result.text, !result.ok);
    },
  );

  async function render(): Promise<{ content: (TextContent | ImageContent)[]; summary: string }> {
    const refuse = (message: string) => ({
      content: [{ type: "text" as const, text: message }],
      summary: message,
    });
    if (previews >= MAX_PREVIEWS) {
      return refuse(
        `这一轮已经预览过 ${MAX_PREVIEWS} 次，不能再预览了。直接向用户说明复刻了什么、还有哪些差距，不要再改样式。`,
      );
    }
    if (now() - startedAt > REPLICA_BUDGET_MS) {
      return refuse(
        "这一轮耗时已超出预算，不再预览。保留当前已保存的样式，向用户说明复刻了什么、可能还有哪些差距。",
      );
    }
    previews++;
    ctx.emit({ type: "style_progress", stage: "previewing", round: previews, max: MAX_PREVIEWS });
    const { png, check } = await (preview as NonNullable<typeof preview>)();
    const warnings = checkLines(check);
    const left = MAX_PREVIEWS - previews;
    const summary = [
      `第 ${previews}/${MAX_PREVIEWS} 次预览，当前 ${check.pages} 页。`,
      ...warnings,
      left > 0
        ? "对照参考图，列出最明显的 1 到 3 处差异（配色、抬头、分区标题、图标、分隔线、字体、版式），用 set_resume_css 一次改完；差异已经很小就不用再改，直接向用户说明。图里的文字内容不要照搬。"
        : "这是最后一次预览：还有明显差异就保存一次小修，之后不要再预览，向用户如实说明哪里还有差距。",
    ].join("\n");
    return {
      content: [
        { type: "text", text: summary },
        { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
      ],
      summary,
    };
  }

  const previewResume = tool(
    "preview_resume",
    "预览简历渲染结果",
    PreviewResumeArgs,
    async (_args: z.infer<typeof PreviewResumeArgs>) => {
      ctx.flags.jobs = true;
      try {
        const { content, summary } = await render();
        log.push({ name: "preview_resume", args: {}, result: summary });
        return { content, details: {} };
      } catch (error) {
        const message = `预览渲染失败：${error instanceof Error ? error.message : String(error)}。当前样式已保存、仍然有效；不要再预览，直接向用户说明。`;
        log.push({ name: "preview_resume", args: {}, result: message });
        return text(message, true);
      }
    },
  );

  return [...tools, setResumeCss, previewResume];
}
