import {
  emptyLedger,
  type Ledger,
  mergeLedgers,
  rebaseLedger,
  type SkipEntry,
  type SummaryNote,
} from "@talksume/agent";
import { type Db, schema } from "@talksume/db";
import { and, asc, desc, eq, exists, isNull, ne, notExists } from "drizzle-orm";

const { conversations, conversationSummaries, intakeLedgers, messages } = schema;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

function rowToLedger(row: typeof intakeLedgers.$inferSelect): Ledger {
  return {
    completedSections: row.completedSections,
    askCounts: row.askCounts,
    skipped: row.skipped as unknown as SkipEntry[],
  };
}

function ledgerColumns(ledger: Ledger) {
  return {
    completedSections: ledger.completedSections,
    askCounts: ledger.askCounts,
    skipped: ledger.skipped as unknown as Record<string, unknown>[],
  };
}

/** 没有账本时把该用户各会话 intake_state 里的老数据合并成一份并落库。 */
export async function loadLedger(db: Executor, userId: string): Promise<Ledger> {
  const [row] = await db.select().from(intakeLedgers).where(eq(intakeLedgers.userId, userId));
  if (row) return rowToLedger(row);
  const legacy = await db
    .select({ intake: conversations.intakeState })
    .from(conversations)
    .where(eq(conversations.userId, userId));
  const merged = mergeLedgers(legacy.map((r) => r.intake));
  if (legacy.length === 0) return merged;
  await db
    .insert(intakeLedgers)
    .values({ userId, ...ledgerColumns(merged) })
    .onConflictDoNothing();
  const [saved] = await db.select().from(intakeLedgers).where(eq(intakeLedgers.userId, userId));
  return saved ? rowToLedger(saved) : merged;
}

/** 按本会话的增量更新账本；before 为本会话加载时看到的账本。 */
export async function saveLedger(tx: Tx, userId: string, before: Ledger, after: Ledger): Promise<void> {
  const [row] = await tx.select().from(intakeLedgers).where(eq(intakeLedgers.userId, userId)).for("update");
  const next = rebaseLedger(row ? rowToLedger(row) : emptyLedger(), before, after);
  await tx
    .insert(intakeLedgers)
    .values({ userId, ...ledgerColumns(next) })
    .onConflictDoUpdate({
      target: intakeLedgers.userId,
      set: { ...ledgerColumns(next), updatedAt: new Date() },
    });
}

export async function recentSummaries(db: Executor, userId: string, limit = 3): Promise<SummaryNote[]> {
  const rows = await db
    .select({
      summary: conversationSummaries.summary,
      topic: conversationSummaries.topic,
      createdAt: conversationSummaries.createdAt,
    })
    .from(conversationSummaries)
    .innerJoin(conversations, eq(conversations.id, conversationSummaries.conversationId))
    .where(and(eq(conversationSummaries.userId, userId), isNull(conversations.deletedAt)))
    .orderBy(desc(conversationSummaries.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    summary: r.summary,
    createdAt: r.createdAt,
    ...(r.topic ? { topic: r.topic } : {}),
  }));
}

/** 除 exceptId 外最近一个有用户发言、还没有摘要的会话。 */
export async function unsummarizedConversation(db: Db, userId: string, exceptId: string) {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        isNull(conversations.deletedAt),
        ne(conversations.id, exceptId),
        notExists(
          db
            .select({ id: conversationSummaries.conversationId })
            .from(conversationSummaries)
            .where(eq(conversationSummaries.conversationId, conversations.id)),
        ),
        exists(
          db
            .select({ id: messages.id })
            .from(messages)
            .where(and(eq(messages.conversationId, conversations.id), eq(messages.role, "user"))),
        ),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  return row?.id;
}

export async function conversationTranscript(db: Db, conversationId: string) {
  return db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
}

export async function saveSummary(
  db: Db,
  input: { userId: string; conversationId: string; summary: string; topic: string },
): Promise<void> {
  await db.insert(conversationSummaries).values(input).onConflictDoNothing();
}
