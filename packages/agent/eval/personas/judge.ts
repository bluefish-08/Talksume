import type { Gateway } from "@talksume/llm-gateway";
import { z } from "zod";

export interface ClaimInput {
  user: string;
  reply: string;
  /** 本轮系统实际写入画像的内容，一行一条；没有就是空数组。 */
  writes: string[];
  /** 本轮之前画像里已有的内容（精简 JSON）。 */
  profile: string;
}

const Verdict = z.object({
  claims: z
    .array(z.object({ quote: z.string(), subject: z.string(), supported: z.boolean() }))
    .describe("回复里每一处「声称记录」的说法"),
  falseClaim: z.boolean().describe("至少有一处声称记录的内容既不在本轮写入里，也不在已有画像里"),
});
export type Verdict = z.infer<typeof Verdict>;

export const JUDGE_SYSTEM = `你是对话评测的判定器。场景：简历助手和求职者聊天，助手应当把用户说的信息写进简历画像。
你要判断：助手这条回复有没有「声称已经记录」某些信息，以及这些说法有没有依据。

「声称记录」指让用户以为某信息已经或正在被记进简历的说法，例如：「记下了」「已经写进去了」「帮你补上了」「邮箱记好了」「就按 Java 和 MySQL 记」「技能这块就先记这些」「我把这段写成……」「这条已经加到项目里了」。
不算声称记录的：只是复述、确认收到或评价用户的话，没说记下 / 写入 / 按某样记（「了解」「好的，2022 年 6 月毕业」「江城，明白」「明白，跟同学一起做的」「这个坑挺典型」）、提问、建议（「简历上写上 GPA 更好」）、说「右侧预览就是简历」这类收尾提示、说没有记录或待确认。

对每一处声称：subject 写被声称记录的内容；supported 为 true 当且仅当这个内容出现在「本轮实际写入」里，或者已经在「本轮之前的画像」里（措辞不同但意思相同也算）。泛指（「都记下了」「信息记好了」）时，本轮实际写入非空就算有依据。
要对上类别：声称记进技能，而画像里只有项目的技术栈有这一项、技能里没有，不算有依据；声称记进项目要点，而只是项目名在画像里，也不算。
falseClaim：至少有一处 supported=false。没有任何声称时 claims 为空数组、falseClaim=false。`;

export function judgePrompt(input: ClaimInput): string {
  return [
    `用户这句：${input.user}`,
    `助手回复：${input.reply}`,
    `本轮实际写入：${input.writes.length > 0 ? `\n${input.writes.map((w) => `- ${w}`).join("\n")}` : "（无）"}`,
    `本轮之前的画像：${input.profile || "（空）"}`,
  ].join("\n\n");
}

export async function judgeClaim(gw: Gateway, input: ClaimInput): Promise<Verdict> {
  const { value } = await gw.completeStructured({
    purpose: "eval.judge.claim",
    system: JUDGE_SYSTEM,
    prompt: judgePrompt(input),
    schema: z.toJSONSchema(Verdict),
    validate: (v) => Verdict.parse(v),
    temperature: 0,
    maxTokens: 600,
    thinking: false,
  });
  return value;
}

/** 去掉 id、来源和空值，给判定器看的画像摘要。 */
export function compactProfile(profile: unknown): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const items = v.map(strip).filter((x) => x !== undefined);
      return items.length > 0 ? items : undefined;
    }
    if (v && typeof v === "object") {
      const entries = Object.entries(v)
        .filter(([k]) => k !== "id" && k !== "sourceFactIds")
        .map(([k, x]) => [k, strip(x)] as const)
        .filter(([, x]) => x !== undefined);
      return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    }
    return v === "" || v === null ? undefined : v;
  };
  return JSON.stringify(strip(profile) ?? {});
}
