import { isDeepStrictEqual } from "node:util";
import {
  type ChatTurn,
  type Conflict,
  computeCompleteness,
  createIntakeState,
  type IntakeState,
  type TurnMeta,
} from "@talksume/agent";
import { type Fact, Profile } from "@talksume/core";
import { type Db, schema } from "@talksume/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";

const { conversations, messages, profileFacts, profiles } = schema;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

export interface Snapshot {
  profile: Profile;
  facts: Map<string, { status: string; payload: unknown }>;
  historyLength: number;
}

export interface LoadedConversation {
  state: IntakeState;
  snapshot: Snapshot;
  title: string | null;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta: TurnMeta;
  createdAt: Date;
}

function toFact(row: typeof profileFacts.$inferSelect): Fact {
  return {
    id: row.id,
    section: row.section,
    payload: row.payload,
    quote: row.quote,
    sourceMessageId: row.sourceMessageId ?? "",
    status: row.status,
  };
}

function intakeOf(state: IntakeState) {
  return {
    completedSections: state.completedSections,
    askCounts: state.askCounts,
    conflicts: state.conflicts,
  };
}

export async function loadProfile(db: Db, userId: string) {
  const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  return { profile: row ? Profile.parse(row.data) : Profile.parse({}), version: row?.version ?? 0 };
}

export async function loadMessages(db: Db, conversationId: string): Promise<StoredMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
  return rows.flatMap((m) =>
    m.role === "user" || m.role === "assistant"
      ? [{ id: m.id, role: m.role, content: m.content, meta: m.metadata as TurnMeta, createdAt: m.createdAt }]
      : [],
  );
}

/** 会话不属于该用户时返回 undefined，调用方一律按 404 处理。 */
export async function loadConversation(
  db: Db,
  userId: string,
  conversationId: string,
): Promise<LoadedConversation | undefined> {
  if (!isUuid(conversationId)) return undefined;
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  if (!conv) return undefined;

  const [{ profile }, factRows, stored] = await Promise.all([
    loadProfile(db, userId),
    db
      .select()
      .from(profileFacts)
      .where(eq(profileFacts.userId, userId))
      .orderBy(asc(profileFacts.createdAt)),
    loadMessages(db, conversationId),
  ]);
  const history: ChatTurn[] = stored.map((m) => ({ id: m.id, role: m.role, content: m.content }));
  const facts = factRows.map(toFact);
  const intake = conv.intakeState;
  const state = createIntakeState({
    profile,
    facts,
    history,
    completedSections: intake.completedSections ?? [],
    askCounts: intake.askCounts ?? {},
    conflicts: (intake.conflicts ?? []) as Conflict[],
  });
  return {
    state,
    title: conv.title,
    snapshot: {
      profile: structuredClone(profile),
      facts: new Map(facts.map((f) => [f.id, { status: f.status, payload: f.payload }])),
      historyLength: history.length,
    },
  };
}

export async function createConversation(
  db: Db,
  userId: string,
  state: IntakeState,
  greeting: { id: string; text: string },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [conv] = await tx
      .insert(conversations)
      .values({ userId, intakeState: intakeOf(state) })
      .returning({ id: conversations.id });
    if (!conv) throw new Error("创建会话失败");
    await tx
      .insert(messages)
      .values({ id: greeting.id, conversationId: conv.id, role: "assistant", content: greeting.text });
    return conv.id;
  });
}

/** 把 state 相对加载时快照的增量写库：新消息、变更的事实、画像、断点状态。 */
export async function persistState(
  db: Db,
  userId: string,
  conversationId: string,
  loaded: LoadedConversation,
): Promise<void> {
  const { state, snapshot } = loaded;
  const newTurns = state.history.slice(snapshot.historyLength);
  const knownMessageIds = new Set(state.history.map((t) => t.id));
  const changedFacts = state.facts.filter((f) => {
    const before = snapshot.facts.get(f.id);
    return !before || before.status !== f.status || !isDeepStrictEqual(before.payload, f.payload);
  });
  const profileChanged = !isDeepStrictEqual(snapshot.profile, state.profile);
  const completeness = computeCompleteness(state.profile, { completedSections: state.completedSections });

  await db.transaction(async (tx) => {
    const base = Date.now();
    if (newTurns.length > 0) {
      await tx.insert(messages).values(
        newTurns.map((turn, i) => ({
          id: turn.id,
          conversationId,
          role: turn.role,
          content: turn.content,
          metadata: turn.meta ?? {},
          createdAt: new Date(base + i),
        })),
      );
    }
    for (const fact of changedFacts) {
      await tx
        .insert(profileFacts)
        .values({
          id: fact.id,
          userId,
          section: fact.section,
          payload: fact.payload,
          quote: fact.quote,
          sourceMessageId: knownMessageIds.has(fact.sourceMessageId) ? fact.sourceMessageId : null,
          status: fact.status,
        })
        .onConflictDoUpdate({
          target: profileFacts.id,
          set: { status: fact.status, payload: fact.payload },
        });
    }
    if (profileChanged) {
      const scores = {
        total: completeness.score,
        ...Object.fromEntries(completeness.sections.map((s) => [s.section, s.score])),
      };
      await tx
        .insert(profiles)
        .values({ userId, data: state.profile, completeness: scores })
        .onConflictDoUpdate({
          target: profiles.userId,
          set: {
            data: state.profile,
            completeness: scores,
            version: sql`${profiles.version} + 1`,
            updatedAt: new Date(),
          },
        });
    }
    const firstUser = newTurns.find((t) => t.role === "user");
    await tx
      .update(conversations)
      .set({
        intakeState: intakeOf(state),
        updatedAt: new Date(),
        ...(firstUser && !loaded.title ? { title: firstUser.content.slice(0, 30) } : {}),
      })
      .where(eq(conversations.id, conversationId));
  });
}

export async function listConversations(db: Db, userId: string, limit = 30) {
  return db
    .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);
}

export async function latestCompletedSections(db: Db, userId: string) {
  const [row] = await db
    .select({ intakeState: conversations.intakeState })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  return row?.intakeState.completedSections ?? [];
}
