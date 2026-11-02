import type { Profile } from "@talksume/core";
import { type Db, schema } from "@talksume/db";
import { and, cosineDistance, eq, isNull, sql } from "drizzle-orm";
import type { Embedder } from "./embedder.ts";
import { visibleTo } from "./jobs-db.ts";
import { profileQueryText } from "./pipeline.ts";

const t = schema.jobs;

/** 给还没有向量的岗位补向量，返回处理条数；单批失败直接抛出，下次重跑会续上。 */
export async function embedPendingJobs(db: Db, embedder: Embedder, batchSize = 32): Promise<number> {
  let done = 0;
  for (;;) {
    const rows = await db
      .select({ id: t.id, company: t.company, title: t.title, jdText: t.jdText })
      .from(t)
      .where(and(isNull(t.embedding), eq(t.status, "open")))
      .orderBy(t.id)
      .limit(batchSize);
    if (rows.length === 0) return done;
    const vectors = await embedder.embed(rows.map((r) => `${r.company} ${r.title}\n${r.jdText}`));
    for (const [i, row] of rows.entries()) {
      const embedding = vectors[i];
      if (embedding) await db.update(t).set({ embedding }).where(eq(t.id, row.id));
    }
    done += rows.length;
  }
}

/** 用画像文本在 pgvector 里取最相近的岗位，返回 jobId → 余弦相似度。 */
export async function vectorScores(
  db: Db,
  userId: string,
  embedder: Embedder,
  profile: Profile,
  limit = 500,
): Promise<Map<string, number>> {
  const [query] = await embedder.embed([profileQueryText(profile)]);
  if (!query) return new Map();
  const distance = cosineDistance(t.embedding, query);
  const rows = await db
    .select({ id: t.id, sim: sql<number>`1 - (${distance})` })
    .from(t)
    .where(and(eq(t.status, "open"), visibleTo(userId), sql`${t.embedding} is not null`))
    .orderBy(distance)
    .limit(limit);
  return new Map(rows.map((r) => [r.id, Number(r.sim)]));
}
