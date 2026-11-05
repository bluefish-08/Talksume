import type { Db } from "@talksume/db";
import type { Gateway } from "@talksume/llm-gateway";
import { z } from "zod";
import { conversationTranscript, saveSummary, unsummarizedConversation } from "./memory-store.ts";

export const SUMMARY_LIMIT = 150;
const TOPIC_LIMIT = 20;
const TRANSCRIPT_TURNS = 40;
const TURN_CHARS = 300;

export interface ConversationSummary {
  summary: string;
  topic: string;
}

export type TranscriptTurn = { role: string; content: string };

export type ConversationSummarizer = (
  transcript: readonly TranscriptTurn[],
  signal?: AbortSignal,
) => Promise<ConversationSummary>;

export const SummaryOutput = z.object({
  summary: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.slice(0, SUMMARY_LIMIT)),
  topic: z
    .string()
    .trim()
    .default("")
    .transform((s) => s.slice(0, TOPIC_LIMIT)),
});

const SYSTEM = [
  "你在给一段求职简历采集对话写备忘，供下次会话的助手参考。",
  `summary 不超过 ${SUMMARY_LIMIT} 字，依次写：这次聊了什么；用户说过回头再补、没说完的事（如「说回头补实习」）；简历字段装不下的软信息，如求职偏好、顾虑、在意的点。`,
  "不要罗列已经记进简历的具体字段值（学校、电话、时间等），不要编造对话里没有的内容，没有的部分就不写。",
  `topic 是这次主要聊到的一个话题，${TOPIC_LIMIT} 字以内，用于开场白「上次聊到…」，如「江城闲置项目」。`,
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", maxLength: SUMMARY_LIMIT },
    topic: { type: "string", maxLength: TOPIC_LIMIT },
  },
  required: ["summary", "topic"],
  additionalProperties: false,
};

export function transcriptPrompt(transcript: readonly TranscriptTurn[]): string {
  return transcript
    .filter((t) => (t.role === "user" || t.role === "assistant") && t.content.trim())
    .slice(-TRANSCRIPT_TURNS)
    .map((t) => `${t.role === "user" ? "用户" : "助手"}：${t.content.slice(0, TURN_CHARS)}`)
    .join("\n");
}

export function gatewaySummarizer(gateway: Pick<Gateway, "completeStructured">): ConversationSummarizer {
  return async (transcript, signal) => {
    const { value } = await gateway.completeStructured({
      purpose: "memory",
      background: true,
      system: SYSTEM,
      prompt: transcriptPrompt(transcript),
      schema: SCHEMA,
      validate: (v) => SummaryOutput.parse(v),
      thinking: false,
      maxTokens: 400,
      ...(signal && { signal }),
    });
    return value;
  };
}

const inflight = new Set<string>();

/** 给 exceptId 之外最近一个没有摘要的会话补摘要；失败只记日志。 */
export async function summarizePrevious(
  db: Db,
  summarize: ConversationSummarizer,
  userId: string,
  exceptId: string,
  onError: (error: unknown) => void,
): Promise<void> {
  let owned: string | undefined;
  try {
    const target = await unsummarizedConversation(db, userId, exceptId);
    if (!target || inflight.has(target)) return;
    owned = target;
    inflight.add(target);
    const transcript = await conversationTranscript(db, target);
    const { summary, topic } = await summarize(transcript);
    await saveSummary(db, { userId, conversationId: target, summary, topic });
  } catch (error) {
    onError(error);
  } finally {
    if (owned) inflight.delete(owned);
  }
}
