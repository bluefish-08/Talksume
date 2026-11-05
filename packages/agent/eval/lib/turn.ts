import type { IntakeController, IntakeState, TurnMetrics } from "../../src/index.ts";

/** 收尾说法，抄自 tools.ts 的 WRAP_UP 并固定在评测侧，被测代码改了也不影响判定。 */
export const WRAP =
  /(?:基本|差不多|都)(?:就)?齐了|右侧(?:的)?(?:预览|就是)|(?:可以|直接)导出|(?:基本|比较|已经)(?:收集)?完整|先到这里|就到这里/;

const ELABORATION = /^(?:比如|例如|譬如|像是?|或者|还是|是不是|或是|你?是?怎么(?:解决|处理|做)的)/;

/** 问句数：以问号结尾的句子；紧跟在问句后、以「比如/或者/还是」开头的补充问不另算。 */
export function countQuestions(text: string): number {
  const sentences = text
    .split("\n")
    .filter((l) => !l.startsWith("［"))
    .join("\n")
    .split(/(?<=[。！!？?\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  let count = 0;
  let prevQuestion = false;
  for (const s of sentences) {
    const q = /[?？]$/.test(s);
    if (q && !(prevQuestion && ELABORATION.test(s))) count++;
    prevQuestion = q;
  }
  return count;
}

export function wrapThenAsk(text: string): boolean {
  const at = text.search(WRAP);
  return at >= 0 && /[?？]/.test(text.slice(at));
}

export interface TurnOutcome {
  reply: string;
  questions: number;
  wraps: boolean;
  wrapThenAsk: boolean;
  asks: { kind: string; question: string; inText: boolean }[];
  jobsShown: number;
  toolCalls: string[];
  error?: { code: string; recoverable: boolean };
  metrics?: TurnMetrics;
}

/** 跑一句用户话，收集用户看到的回复和本轮指标。 */
export async function runTurn(
  controller: IntakeController,
  state: IntakeState,
  id: string,
  text: string,
  pending: TurnMetrics[],
): Promise<TurnOutcome> {
  let reply = "";
  const asks: TurnOutcome["asks"] = [];
  let jobsShown = 0;
  let error: TurnOutcome["error"];
  const before = pending.length;
  for await (const event of controller.handleUserMessage(state, { id, text })) {
    if (event.type === "token") reply += event.text;
    else if (event.type === "ask") {
      asks.push({ kind: event.kind, question: event.question, inText: Boolean(event.inText) });
      if (!event.inText) reply += `${reply ? "\n" : ""}${event.question}`;
      if (event.quickReplies) reply += `\n［快捷回答：${event.quickReplies.join(" / ")}］`;
    } else if (event.type === "jobs") jobsShown += event.jobs.length;
    else if (event.type === "error") {
      error = { code: event.code, recoverable: event.recoverable };
      reply += `\n［错误 ${event.code}］`;
    }
  }
  const metrics = pending.length > before ? pending[pending.length - 1] : undefined;
  reply = reply.trim();
  return {
    reply,
    questions: countQuestions(reply),
    wraps: WRAP.test(reply),
    wrapThenAsk: wrapThenAsk(reply),
    asks,
    jobsShown,
    toolCalls: metrics?.modelCalls.flatMap((c) => c.toolCalls) ?? [],
    ...(error ? { error } : {}),
    ...(metrics ? { metrics } : {}),
  };
}
