import { type Db, schema } from "@talksume/db";
import type { Gateway } from "@talksume/llm-gateway";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { LoadedConversation } from "./conversation-store.ts";

const { conversations } = schema;

export interface TitleTurn {
  role: "user" | "assistant";
  content: string;
}

/** 返回模型原文，清洗统一由调度器做。 */
export interface ConversationTitler {
  generate(turns: TitleTurn[], options: { current?: string; signal?: AbortSignal }): Promise<string>;
}

/** 第 1 轮生成，第 3 轮让模型判断主题是否变了，最多两次。 */
export const TITLE_ROUNDS = [1, 3];
const MIN_CHARS = 2;
const MAX_CHARS = 16;
const PER_TURN_CHARS = 200;
const TRANSCRIPT_CHARS = 1200;
const TIMEOUT_MS = 20_000;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const DIGIT_RUN = /\+?\d[\d -]{5,}\d/g;
const PREFIX = /^(?:会话|对话)?标题\s*[:：]\s*/;
const PUNCT = /(?![+#])[\p{P}\p{S}]/gu;

/** 模型没配或还没生成时的兜底标题。 */
export const fallbackTitle = (firstUserMessage: string) => firstUserMessage.slice(0, 30);

export function sanitizeTitle(raw: string): string | undefined {
  const line = raw.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const cleaned = line
    .trim()
    .replace(PREFIX, "")
    .replace(EMAIL, "")
    .replace(DIGIT_RUN, "")
    .replace(PUNCT, "")
    .replace(/\s+/g, " ")
    .replace(/ (?![A-Za-z0-9])|(?<![A-Za-z0-9]) /g, "")
    .trim();
  const title = [...cleaned].slice(0, MAX_CHARS).join("").trim();
  return [...title].length >= MIN_CHARS ? title : undefined;
}

export function titleTranscript(turns: TitleTurn[]): string {
  const start = turns.findIndex((t) => t.role === "user");
  const lines = (start < 0 ? [] : turns.slice(start)).map(
    (t) =>
      `${t.role === "user" ? "用户" : "助手"}：${t.content.replace(/\s+/g, " ").slice(0, PER_TURN_CHARS)}`,
  );
  return lines.join("\n").slice(0, TRANSCRIPT_CHARS);
}

const SYSTEM = [
  "你给简历助手和求职者的对话起标题。",
  "用 6 到 14 个汉字概括这次对话的主题，比如：李明的基本信息与项目、后台开发岗简历诊断、岗位推荐咨询。",
  "只输出标题本身，不要标点、引号和解释，不要出现手机号、邮箱等联系方式。",
].join("\n");

export function gatewayTitler(gateway: Pick<Gateway, "complete">): ConversationTitler {
  return {
    async generate(turns, { current, signal }) {
      const keep = current
        ? `\n\n当前标题：${current}\n看最近几轮在聊什么：如果已经转到别的事（比如从补充个人信息转到投递某个岗位、诊断简历、找工作），按新主题起标题；还在聊同一件事就原样输出当前标题。`
        : "";
      const { text } = await gateway.complete({
        purpose: "title",
        background: true,
        system: SYSTEM,
        prompt: `对话：\n${titleTranscript(turns)}${keep}`,
        thinking: false,
        maxRetries: 1,
        maxTokens: 64,
        temperature: 0.3,
        ...(signal && { signal }),
      });
      return text;
    },
  };
}

export function titleRound(loaded: LoadedConversation): number | undefined {
  const { history } = loaded.state;
  if (!history.slice(loaded.snapshot.historyLength).some((t) => t.role === "user")) return undefined;
  const round = history.filter((t) => t.role === "user").length;
  return TITLE_ROUNDS.includes(round) ? round : undefined;
}

/** 只覆盖自动标题，用户在生成期间改了名也不会被冲掉。 */
export async function saveAutoTitle(db: Db, conversationId: string, title: string) {
  await db
    .update(conversations)
    .set({ title })
    .where(and(eq(conversations.id, conversationId), eq(conversations.titleSource, "auto")));
}

export async function renameConversation(db: Db, userId: string, conversationId: string, title: string) {
  const [row] = await db
    .update(conversations)
    .set({ title, titleSource: "user" })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
        isNull(conversations.deletedAt),
      ),
    )
    .returning({ id: conversations.id, title: conversations.title, titleSource: conversations.titleSource });
  return row;
}

export function createTitleScheduler(db: Db, titler: ConversationTitler | undefined, log: FastifyBaseLogger) {
  const jobs = new Set<Promise<void>>();

  async function run(conversationId: string, turns: TitleTurn[], current: string | undefined) {
    const raw = await titler?.generate(turns, {
      ...(current && { current }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const title = raw === undefined ? undefined : sanitizeTitle(raw);
    if (title && title !== current) await saveAutoTitle(db, conversationId, title);
  }

  return {
    /** 落库成功后调用；返回是否已在后台开始生成。 */
    schedule(conversationId: string, loaded: LoadedConversation): boolean {
      if (!titler || loaded.titleSource === "user") return false;
      const round = titleRound(loaded);
      if (!round) return false;
      const turns = loaded.state.history.map(({ role, content }) => ({ role, content }));
      const firstUser = turns.find((t) => t.role === "user")?.content ?? "";
      const current =
        round > 1 && loaded.title && loaded.title !== fallbackTitle(firstUser) ? loaded.title : undefined;
      const job: Promise<void> = run(conversationId, turns, current)
        .catch((error: unknown) => log.warn({ err: error, conversationId }, "title generation failed"))
        .finally(() => jobs.delete(job));
      jobs.add(job);
      return true;
    },
    async drain() {
      await Promise.allSettled([...jobs]);
    },
  };
}
