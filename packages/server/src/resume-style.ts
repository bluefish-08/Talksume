import type { ResumeStyler } from "@talksume/agent";
import { applyThemePatch, type ResumeStyle, resolveResumeStyle } from "@talksume/core";
import { type Db, schema } from "@talksume/db";
import { eq } from "drizzle-orm";

export async function loadResumeStyle(db: Db, userId: string): Promise<ResumeStyle> {
  const [row] = await db
    .select({ style: schema.users.resumeStyle })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return resolveResumeStyle(row?.style);
}

export async function saveResumeStyle(db: Db, userId: string, style: ResumeStyle): Promise<boolean> {
  const updated = await db
    .update(schema.users)
    .set({ resumeStyle: style })
    .where(eq(schema.users.id, userId))
    .returning({ id: schema.users.id });
  return updated.length > 0;
}

export function storeResumeStyler(db: Db, userId: string): ResumeStyler {
  const save = async (style: ResumeStyle) => {
    if (!(await saveResumeStyle(db, userId, style))) throw new Error("用户不存在");
  };
  return {
    async design(patch) {
      const change = applyThemePatch(await loadResumeStyle(db, userId), patch);
      if (!change) throw new Error("样式参数不合法");
      await save(change.style);
      return change;
    },
    async reset() {
      const { template, accent } = await loadResumeStyle(db, userId);
      const style = { template, accent };
      await save(style);
      return style;
    },
  };
}
