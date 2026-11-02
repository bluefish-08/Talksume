import { type ResumeStyle, resolveResumeStyle } from "@talksume/core";
import { type Db, schema } from "@talksume/db";
import { eq } from "drizzle-orm";

export async function loadResumeStyle(db: Db, userId: string): Promise<ResumeStyle> {
  const [row] = await db
    .select({ style: schema.users.resumeStyle })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return resolveResumeStyle(row?.style);
}
