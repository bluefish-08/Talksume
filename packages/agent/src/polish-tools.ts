import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import type { z } from "zod";
import { DecidePolishArgs, PolishResumeArgs, type ToolName } from "./schemas.ts";
import { type RunContext, text, tool } from "./tools.ts";
import type { PolishCard, PolishCardItem, ResumePolisher, ToolRecord } from "./types.ts";

const POLISH_NO_INTAKE =
  "这一轮只谈润色：不要问任何建档问题，也不要提用户还没说过的其他经历；这一轮不问问题。";

const POLISH_UPDATE_NOTE = `只有工具返回成功时才能说已经采用、已经放弃或已经改回；失败或找不到时如实告诉用户，不要说已经生效。回复只用一两句话确认改了什么，不要复述清单，不要开启新的建档话题。${POLISH_NO_INTAKE}`;

const POLISH_CARD_NOTE = "改动列在对话里的润色卡片上；想对照简历就点卡片上的「在右边看」。";

const STATE_LABEL = { pending: "待定", accepted: "已采用", dismissed: "不要" } as const;

/** 按字符截断，超长才加省略号；卡片和工具结果用同一套长度。 */
export function clipText(text: string, limit: number): string {
  const chars = Array.from(text.trim());
  return chars.length > limit ? `${chars.slice(0, limit).join("")}…` : chars.join("");
}

export function polishItemLine(item: PolishCardItem): string {
  if (item.blocked)
    return `- ${item.heading} [${item.id}]：不能用（没改：${(item.violations ?? []).join("、")} 你没说过）`;
  return `- ${item.number}. ${item.heading}：「${clipText(item.before, 12)}」→「${clipText(item.after, 20)}」 [${item.id}]：${STATE_LABEL[item.state]}`;
}

export function describePolish(card: PolishCard): string[] {
  return card.items.map(polishItemLine);
}

function unknownNote(
  unknown: readonly string[] | undefined,
  headings: readonly string[] | undefined,
): string {
  if (!unknown || unknown.length === 0) return "";
  const available = headings && headings.length > 0 ? headings.join("、") : "简历里还没有带要点的条目";
  return `找不到这些条目：${unknown.join("、")}；可以润色的条目标题：${available}。没有编造这些条目。`;
}

function noopNote(items: readonly { heading: string; before: string }[]): string {
  if (items.length === 0) return "";
  const list = items.map((item) => `${item.heading}「${clipText(item.before, 12)}」`).join("、");
  return `这 ${items.length} 条原本就写得够清楚，没改：${list}`;
}

function failedNote(name: ToolName, reason: string): string {
  if (name === "decide_polish")
    return `这次没有改成功：${reason}。如实告诉用户哪条没改，不要说已经采用或已经放弃。${POLISH_NO_INTAKE}`;
  return `润色失败：${reason}。如实告诉用户这次没有生成润色建议，可以稍后再试；绝对不要说已经改好。${POLISH_NO_INTAKE}`;
}

const plain = (args: object) => JSON.parse(JSON.stringify(args)) as Record<string, unknown>;

/** 润色工具只动措辞、不写画像；失败也不计入 intake 的 failures。 */
export function createPolishTools(
  ctx: RunContext,
  polisher: ResumePolisher,
  log: ToolRecord[],
): AgentTool<TSchema>[] {
  async function run(name: ToolName, args: object, work: () => Promise<string>) {
    let result: string;
    try {
      result = await work();
    } catch (error) {
      result = failedNote(name, error instanceof Error ? error.message : String(error));
    }
    ctx.flags.polished = true;
    log.push({ name, args: plain(args), result });
    return text(result);
  }

  const polishResume = tool(
    "polish_resume",
    "润色简历",
    PolishResumeArgs,
    (args: z.infer<typeof PolishResumeArgs>) =>
      run("polish_resume", args, async () => {
        const outcome = await polisher.polish(ctx.state.profile, {
          ...(args.items && { items: args.items }),
          ...(args.instruction && { instruction: args.instruction }),
        });
        const polished = outcome.polished ?? outcome.card.items.length;
        const lines =
          outcome.lines && outcome.lines.length > 0 ? outcome.lines : describePolish(outcome.card);
        if (polished > 0) ctx.emit({ type: "polish", polish: { ...outcome.card, kind: "generation" } });
        const unknown = unknownNote(outcome.unknownItems, outcome.headings);
        const noop = noopNote(outcome.noopItems ?? []);
        if (polished === 0) {
          if (noop)
            return [
              noop,
              "没有需要改动的地方。如实告诉用户这些要点已经够清楚，不要说已经润色。",
              POLISH_UPDATE_NOTE,
            ].join("\n");
          const reason =
            outcome.unknownItems && outcome.unknownItems.length > 0
              ? unknown
              : `没有可润色的经历要点${outcome.headings && outcome.headings.length > 0 ? `；现有条目标题：${outcome.headings.join("、")}` : ""}。如实告诉用户先补项目或实习经历，不要说已经润色。`;
          return [reason, POLISH_UPDATE_NOTE].filter(Boolean).join("\n");
        }
        return [
          `已生成 ${polished} 处润色建议，编号和简历上的标记一致：`,
          ...lines,
          noop,
          unknown,
          POLISH_CARD_NOTE,
          POLISH_UPDATE_NOTE,
        ]
          .filter(Boolean)
          .join("\n");
      }),
  );

  const decidePolish = tool(
    "decide_polish",
    "处理润色建议",
    DecidePolishArgs,
    (args: z.infer<typeof DecidePolishArgs>) =>
      run("decide_polish", args, async () => {
        const outcome = await polisher.decide(ctx.state.profile, {
          ...(args.accept && { accept: args.accept }),
          ...(args.dismiss && { dismiss: args.dismiss }),
          ...(args.revert && { revert: args.revert }),
          ...(args.all && { all: args.all }),
        });
        ctx.emit({ type: "polish", polish: { ...outcome.card, kind: "update" } });
        const lines =
          outcome.lines && outcome.lines.length > 0 ? outcome.lines : describePolish(outcome.card);
        const notes = [
          outcome.unknownIds && outcome.unknownIds.length > 0
            ? `找不到这些润色 id：${outcome.unknownIds.join("、")}，没有改它们。`
            : "",
          outcome.blockedIds && outcome.blockedIds.length > 0
            ? `${outcome.blockedIds.join("、")} 出现原文没有的内容，不能采用，已经跳过。`
            : "",
        ].filter(Boolean);
        return ["已更新润色建议的状态。", ...lines, ...notes, POLISH_UPDATE_NOTE].join("\n");
      }),
  );

  return [polishResume, decidePolish];
}
