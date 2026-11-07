import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent, TSchema } from "@earendil-works/pi-ai";
import {
  DESIGN_DIRECTIONS,
  describeTheme,
  designFeatures,
  featureDistance,
  styleFromDirection,
  TEMPLATE_INFO,
} from "@talksume/core";
import type { z } from "zod";
import { DesignResumeStyleArgs, PreviewResumeArgs, ProposeDesignsArgs, SetResumeCssArgs } from "./schemas.ts";
import { type RunContext, text, tool } from "./tools.ts";
import type { DesignOption, ResumeStyler, StylePreviewCheck, ToolRecord } from "./types.ts";

const SAVED_NOTE =
  "右侧预览已经换成这套样式，导出 PDF 也会按它来；只改了外观，简历内容没动。用一两句话告诉用户改了哪些地方，请用户看看右边的预览，不满意可以接着说想怎么调，也可以在简历上方的样式按钮（调色板图标）里换回预设模板。";

const SIDEBAR_NOTE = "两栏版式在部分网申系统（ATS）里可能读乱，顺带提醒一句：投大厂网申时可以换回单栏。";

const FAILED_NOTE =
  "如实告诉用户这次样式没改成功，可以稍后再试，或在简历上方的样式按钮（调色板图标）里手动换模板；绝对不要说已经改好。";

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
    (check.covered ?? 0) > 0
      ? `有 ${check.covered} 处文字被装饰盖住（上层有伪元素压着）：伪元素加 z-index: -1 放到文字下面，或挪开。`
      : "",
    check.overlaps > 0 ? `有 ${check.overlaps} 处文字块互相重叠，检查绝对定位和负边距。` : "",
  ].filter(Boolean);
}

/** 同组两版外观特征至少有这个比例不同，否则算太像。 */
const MIN_DISTANCE = 0.44;

/** 一轮对话里最多提交几次三版设计（第二次用来修被拒绝的版本）。 */
export const MAX_PROPOSALS = 2;

const DESIGN_STANDARDS =
  "对着缩略图按设计标准自检：层级（姓名最醒目，分区标题次之，正文最弱）、对齐（左边线整齐）、留白（不挤不空）、对比度（文字都看得清）、一页排得下。三版必须一眼能分出来；明显雷同或有硬伤就换骨架或配色，用最后一次提交机会修好。";

/** 样式工具不写画像，算旁支任务：这一轮不强制追问、不触发收尾。 */
export function createStyleTools(
  ctx: RunContext,
  styler: ResumeStyler,
  log: ToolRecord[],
  options: { replica?: boolean; now?: () => number; directions?: boolean } = {},
): AgentTool<TSchema>[] {
  const now = options.now ?? Date.now;
  const directionsOnly = options.directions ?? false;
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
  const { propose } = styler;
  let proposals = 0;
  let steered = false;

  let history: string[] | undefined;

  async function proposeWork(
    args: z.infer<typeof ProposeDesignsArgs>,
  ): Promise<{ content: (TextContent | ImageContent)[]; summary: string; error?: boolean }> {
    const refuse = (message: string) => ({
      content: [{ type: "text" as const, text: message }],
      summary: message,
      error: true,
    });
    if (!propose) return refuse("当前环境不支持一次出多版设计，改用 design_resume_style 调整。");
    // 有候选方向时先挡一次自己拼的主题：方向里的版式手法比临时拼的完整；不占提交次数
    if (directionsOnly && !steered && args.designs.some((d) => !d.direction)) {
      steered = true;
      return refuse(
        "请改用方向库：每版只填 direction（从系统提示里「本轮候选方向」挑，三版骨架互不相同、字体/抬头/标题样式拉开）。候选里确实没有合适的，才可以再提交一次完整 theme。这次还没有渲染，不占提交次数。",
      );
    }
    if (proposals >= MAX_PROPOSALS) {
      return refuse(
        `这一轮已经提交过 ${MAX_PROPOSALS} 次，不能再提交了。把已经出的版本介绍给用户，请用户点选或说想怎么改。`,
      );
    }
    proposals++;
    ctx.emit({ type: "style_progress", stage: "designing", round: proposals, max: MAX_PROPOSALS });
    history ??= (await styler.recentDirections?.()) ?? [];
    const { options, rejected } = await propose(
      args.designs.map((d) => ({
        ...(d.summary && { summary: d.summary }),
        ...(d.direction && { direction: d.direction }),
        ...(d.accent && { accent: d.accent }),
        ...(d.theme && { theme: d.theme }),
        ...(d.css && { css: d.css }),
      })),
    );
    const kept: DesignOption[] = [];
    const dropped: string[] = [];
    const skeletons = new Set<string>();
    for (const o of options) {
      const bone = o.style.theme?.skeleton ?? "classic";
      if (skeletons.has(bone))
        dropped.push(`「${o.name}」和前面的版本骨架相同（${bone}），同一组三版必须用三种不同的骨架`);
      else if (proposals === 1 && o.direction && history.includes(o.direction))
        dropped.push(`「${o.name}」是这位用户之前见过的方向，换一个没见过的`);
      else {
        const clash = kept.find(
          (k) => featureDistance(designFeatures(k.style), designFeatures(o.style)) < MIN_DISTANCE,
        );
        if (clash)
          dropped.push(
            `「${o.name}」和「${clash.name}」外观太像（字体、抬头、标题样式、配色大多相同），三版要拉开`,
          );
        else {
          skeletons.add(bone);
          kept.push(o);
        }
      }
    }
    const final = proposals >= MAX_PROPOSALS;
    let filled = 0;
    if (final && kept.length < 3) {
      // 最后一次仍凑不齐三版：从方向库里挑与已有版本差得开的补上，不让用户只看到一两版
      const used = new Set(options.map((o) => o.direction).filter(Boolean));
      const picks: string[] = [];
      const shuffled = [...DESIGN_DIRECTIONS].sort(() => Math.random() - 0.5);
      const have = kept.map((o) => designFeatures(o.style));
      while (kept.length + picks.length < 3) {
        const next = shuffled
          .filter((d) => !used.has(d.id) && !history?.includes(d.id) && !picks.includes(d.id))
          .filter((d) => !skeletons.has(d.skeleton))
          .map((d) => {
            const built = styleFromDirection(d);
            const f = built.ok ? designFeatures(built.style) : undefined;
            return { d, gap: f ? Math.min(...have.map((h) => featureDistance(h, f)), 1) : -1 };
          })
          .filter((c) => c.gap >= 0)
          .sort((x, y) => y.gap - x.gap)[0];
        if (!next) break;
        picks.push(next.d.id);
        skeletons.add(next.d.skeleton);
        const built = styleFromDirection(next.d);
        if (built.ok) have.push(designFeatures(built.style));
      }
      if (picks.length > 0) {
        const extra = await propose(picks.map((direction) => ({ direction })));
        for (const o of extra.options) kept.push(o);
        filled = extra.options.length;
      }
    }
    const lines = [
      `第 ${proposals}/${MAX_PROPOSALS} 次提交：${kept.length} 版通过，${rejected.length + dropped.length} 版没通过。`,
      ...rejected.map((r) => `第 ${r.index + 1} 版没通过：\n${r.errors.map((e) => `  - ${e}`).join("\n")}`),
      ...dropped.map((d) => `- ${d}`),
      ...(filled > 0 ? [`系统从方向库里补了 ${filled} 版差异大的，一并展示。`] : []),
      ...kept.flatMap((o, i) => {
        const warnings = checkLines(o.check);
        return warnings.length > 0
          ? [`「${o.name}」（第 ${i + 1} 张缩略图）有问题：${warnings.join("")}`]
          : [];
      }),
    ];
    const clean = lines.length === 1;
    const safe = kept.find((o) => o.ats.ok);
    const risky = kept.filter((o) => !o.ats.ok);
    const atsLines = risky.map(
      (o) =>
        `「${o.name}」导出后网申系统可能读不全（${o.ats.issues.join("；")}）。介绍时如实告诉用户${safe ? `，投网申建议换用「${safe.name}」` : "，投网申建议换回预设模板"}。`,
    );
    const ready = kept.length === 3 && clean;
    if (ready || final) {
      if (kept.length > 0) {
        ctx.emit({ type: "style_options", options: kept });
        ctx.flags.designs = true;
      }
      ctx.flags.styled = kept.length > 0;
    }
    if (ready || final)
      lines.push(
        `展示给用户的版本（缩略图顺序）：${kept.map((o, i) => `${i + 1}.「${o.name}」${o.summary}`).join("；")}。介绍时按这个顺序、这些名字说，不要提没展示的版本。`,
      );
    lines.push(
      ready || final
        ? kept.length > 0
          ? `缩略图已经展示给用户，尚未保存。${atsLines.join("")}${DESIGN_STANDARDS}用两三句话介绍各版的气质，只请用户点选，不要再问画像里的问题，不要说已经应用。`
          : "三版都没通过，如实告诉用户这次没设计成功，可以换个说法再试。"
        : `还没展示给用户。${DESIGN_STANDARDS}按上面的问题修好后再提交一次（这是最后一次机会，三版都要完整重新提交）。`,
    );
    const summary = lines.join("\n");
    return {
      content: [
        { type: "text", text: summary },
        ...kept.map((o) => ({
          type: "image" as const,
          data: o.thumbnail.replace(/^data:[^,]*,/, ""),
          mimeType: "image/jpeg",
        })),
      ],
      summary,
    };
  }

  const proposeResumeDesigns = tool(
    "propose_resume_designs",
    "一次出 3 版简历设计",
    ProposeDesignsArgs,
    async (args: z.infer<typeof ProposeDesignsArgs>) => {
      ctx.flags.jobs = true;
      try {
        const { content, summary, error } = await proposeWork(args);
        log.push({ name: "propose_resume_designs", args: JSON.parse(JSON.stringify(args)), result: summary });
        return error ? text(summary, true) : { content, details: {} };
      } catch (error) {
        const message = `生成设计失败：${error instanceof Error ? error.message : String(error)}。${FAILED_NOTE}`;
        log.push({ name: "propose_resume_designs", args: {}, result: message });
        return text(message, true);
      }
    },
  );
  if (propose) tools.push(proposeResumeDesigns);

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
        : "预览次数已用完，不要再调用 preview_resume，直接向用户说明复刻了什么、还有哪些差距，不要说「完全一致」。";
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
        : "这是最后一次预览：还有明显差异就保存一次小修，之后不要再预览，向用户如实说明哪里还有差距，不要说「完全一致」。",
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
