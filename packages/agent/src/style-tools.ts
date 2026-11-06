import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import { describeTheme, TEMPLATE_INFO } from "@talksume/core";
import type { z } from "zod";
import { DesignResumeStyleArgs } from "./schemas.ts";
import { type RunContext, text, tool } from "./tools.ts";
import type { ResumeStyler, ToolRecord } from "./types.ts";

const SAVED_NOTE =
  "右侧预览已经换成这套样式，导出 PDF 也会按它来；只改了外观，简历内容没动。用一两句话告诉用户改了哪些地方，请用户看看右边的预览，不满意可以接着说想怎么调，也可以在简历上方的样式下拉里换回预设模板。";

const SIDEBAR_NOTE = "两栏版式在部分网申系统（ATS）里可能读乱，顺带提醒一句：投大厂网申时可以换回单栏。";

const FAILED_NOTE =
  "如实告诉用户这次样式没改成功，可以稍后再试，或在简历上方的样式下拉里手动换模板；绝对不要说已经改好。";

/** 样式工具不写画像，算旁支任务：这一轮不强制追问、不触发收尾。 */
export function createStyleTools(
  ctx: RunContext,
  styler: ResumeStyler,
  log: ToolRecord[],
): AgentTool<TSchema>[] {
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

  return [designResumeStyle];
}
