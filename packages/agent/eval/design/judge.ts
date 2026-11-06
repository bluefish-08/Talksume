import type { Gateway } from "@talksume/llm-gateway";
import { z } from "zod";

const Score = z.number().int().min(1).max(5);
export const ScoresSchema = z.object({
  hierarchy: Score.describe("层级：姓名最醒目，分区标题次之，正文最弱，一眼分得出"),
  alignment: Score.describe("对齐：左边线、栏边线整齐，没有错位或挤在一起"),
  whitespace: Score.describe("留白：疏密得当，不挤不空，节奏均匀"),
  contrast: Score.describe("对比度：文字都看得清，色块上的字够醒目"),
  overall: Score.describe("整体：像不像一份专业设计过的简历，而不是套了个颜色"),
  note: z.string().max(80).describe("一句话说最大的问题或亮点"),
});
export type Scores = Pick<
  z.infer<typeof ScoresSchema>,
  "hierarchy" | "alignment" | "whitespace" | "contrast" | "overall"
> & {
  note?: string;
};

const SYSTEM = `你是简历版式的评审，看的是一页简历的缩略图。只按设计标准打分，不评价内容本身。每项 1–5 分：
1 很差（明显缺陷）、2 较差、3 合格（能用但平淡）、4 好（有设计思路，细节到位）、5 出色（像专业设计师做的）。
打分要拉开：平淡无奇的单栏加下划线最多 3 分；只有真的有设计手法（层级清晰、装饰克制得当、留白有节奏）才给 4 以上。`;

export async function aestheticOf(gw: Gateway, jpegBase64: string): Promise<Scores> {
  const { value } = await gw.completeStructured({
    purpose: "eval.judge.design",
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "给这页简历版式打分，按 JSON 输出。" },
          { type: "image", data: jpegBase64, mimeType: "image/jpeg" },
        ],
        timestamp: Date.now(),
      },
    ],
    schema: z.toJSONSchema(ScoresSchema),
    validate: (v) => ScoresSchema.parse(v),
    temperature: 0,
    maxTokens: 400,
    thinking: false,
  });
  return value;
}

/** 评审模型得真能看图：给一张有通栏色块抬头的和一张没有的，答错就不可用（DeepSeek 官方接口是纯文本，会瞎编）。 */
export async function visionCanary(gw: Gateway, withBand: string, withoutBand: string): Promise<boolean> {
  const ask = async (data: string) => {
    const r = await gw.complete({
      purpose: "eval.judge.canary",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "这页简历顶部有没有一整条深色或彩色的色块抬头？只答「有」或「没有」。" },
            { type: "image", data, mimeType: "image/jpeg" },
          ],
          timestamp: Date.now(),
        },
      ],
      maxTokens: 20,
      temperature: 0,
      thinking: false,
    });
    return r.text.trim().startsWith("有");
  };
  return (await ask(withBand)) && !(await ask(withoutBand));
}
