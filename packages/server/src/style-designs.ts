import { type ResumeStyle, resolveResumeStyle } from "@talksume/core";
import { type Db, schema } from "@talksume/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { loadResumeStyle, saveResumeStyle } from "./resume-style.ts";

export const MAX_STYLE_DESIGNS = 30;

export type StyleDesignSource = "options" | "chat";

export interface StyleDesign {
  id: string;
  name: string;
  style: ResumeStyle;
  source: StyleDesignSource;
  createdAt: Date;
}

const COLUMNS = {
  id: schema.resumeStyleDesigns.id,
  name: schema.resumeStyleDesigns.name,
  style: schema.resumeStyleDesigns.style,
  source: schema.resumeStyleDesigns.source,
  createdAt: schema.resumeStyleDesigns.createdAt,
};

/** 预设样式没有 theme / css，不占设计历史。 */
export function isCustomStyle(style: ResumeStyle): boolean {
  return Boolean(style.theme || style.css);
}

/** 键排序后的 JSON，用来判断两份样式是否真的相同。 */
export function styleKey(style: ResumeStyle): string {
  return JSON.stringify(sorted(style));
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function nameFor(style: ResumeStyle): string {
  return style.theme?.name ?? "参考图复刻";
}

async function trim(db: Db, userId: string): Promise<void> {
  const rows = await db
    .select({ id: schema.resumeStyleDesigns.id })
    .from(schema.resumeStyleDesigns)
    .where(eq(schema.resumeStyleDesigns.userId, userId))
    .orderBy(desc(schema.resumeStyleDesigns.createdAt), desc(schema.resumeStyleDesigns.id));
  const stale = rows.slice(MAX_STYLE_DESIGNS).map((row) => row.id);
  if (stale.length === 0) return;
  await db
    .delete(schema.resumeStyleDesigns)
    .where(and(eq(schema.resumeStyleDesigns.userId, userId), inArray(schema.resumeStyleDesigns.id, stale)));
}

async function query(db: Db, userId: string): Promise<StyleDesign[]> {
  return db
    .select(COLUMNS)
    .from(schema.resumeStyleDesigns)
    .where(eq(schema.resumeStyleDesigns.userId, userId))
    .orderBy(desc(schema.resumeStyleDesigns.createdAt), desc(schema.resumeStyleDesigns.id));
}

export async function recordResumeStyleDesign(
  db: Db,
  userId: string,
  style: ResumeStyle,
  source: StyleDesignSource,
  name = nameFor(style),
): Promise<StyleDesign | null> {
  if (!isCustomStyle(style)) return null;
  const key = styleKey(style);
  const existing = await db
    .select({ style: schema.resumeStyleDesigns.style })
    .from(schema.resumeStyleDesigns)
    .where(eq(schema.resumeStyleDesigns.userId, userId));
  if (existing.some((row) => styleKey(row.style) === key)) return null;
  const [row] = await db
    .insert(schema.resumeStyleDesigns)
    .values({ userId, name, style, source })
    .returning(COLUMNS);
  await trim(db, userId);
  return row ?? null;
}

/** 老用户的当前定制样式没有历史时，列表里补到最前面。 */
export async function listResumeStyleDesigns(db: Db, userId: string): Promise<StyleDesign[]> {
  const current = await loadResumeStyle(db, userId);
  let rows = await query(db, userId);
  if (!isCustomStyle(current)) return rows;
  const key = styleKey(current);
  if (rows.some((row) => styleKey(row.style) === key)) return rows;
  await recordResumeStyleDesign(db, userId, current, "chat");
  rows = await query(db, userId);
  return rows;
}

export async function currentStyleDesignId(
  db: Db,
  userId: string,
  designs: StyleDesign[],
): Promise<string | null> {
  const current = await loadResumeStyle(db, userId);
  if (!isCustomStyle(current)) return null;
  const key = styleKey(current);
  return designs.find((design) => styleKey(design.style) === key)?.id ?? null;
}

export async function applyResumeStyleDesign(
  db: Db,
  userId: string,
  id: string,
): Promise<ResumeStyle | null> {
  const [row] = await db
    .select({ style: schema.resumeStyleDesigns.style })
    .from(schema.resumeStyleDesigns)
    .where(and(eq(schema.resumeStyleDesigns.id, id), eq(schema.resumeStyleDesigns.userId, userId)));
  if (!row) return null;
  const style = resolveResumeStyle(row.style);
  if (!(await saveResumeStyle(db, userId, style))) return null;
  return style;
}

export type DeleteStyleDesignResult = "deleted" | "current" | "not_found";

export async function deleteResumeStyleDesign(
  db: Db,
  userId: string,
  id: string,
): Promise<DeleteStyleDesignResult> {
  const [row] = await db
    .select({ style: schema.resumeStyleDesigns.style })
    .from(schema.resumeStyleDesigns)
    .where(and(eq(schema.resumeStyleDesigns.id, id), eq(schema.resumeStyleDesigns.userId, userId)));
  if (!row) return "not_found";
  const current = await loadResumeStyle(db, userId);
  if (isCustomStyle(current) && styleKey(row.style) === styleKey(current)) return "current";
  const deleted = await db
    .delete(schema.resumeStyleDesigns)
    .where(and(eq(schema.resumeStyleDesigns.id, id), eq(schema.resumeStyleDesigns.userId, userId)))
    .returning({ id: schema.resumeStyleDesigns.id });
  return deleted.length > 0 ? "deleted" : "not_found";
}
