import type { ChatImage } from "@talksume/agent";
import { type Db, schema } from "@talksume/db";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { type CleanImage, IMAGE_LIMITS } from "./images.ts";

const { userImages } = schema;

export interface StoredImage {
  id: string;
  mimeType: CleanImage["mimeType"];
  width: number;
  height: number;
  byteSize: number;
}

/** 存清洗后的图片，并把该用户超出上限的旧图删掉。 */
export async function saveUserImage(db: Db, userId: string, image: CleanImage): Promise<StoredImage> {
  const [row] = await db
    .insert(userImages)
    .values({
      userId,
      mimeType: image.mimeType,
      byteSize: image.data.length,
      width: image.width,
      height: image.height,
      data: image.data,
    })
    .returning({ id: userImages.id });
  const keep = await db
    .select({ id: userImages.id })
    .from(userImages)
    .where(eq(userImages.userId, userId))
    .orderBy(desc(userImages.createdAt))
    .limit(IMAGE_LIMITS.perUser);
  await db.delete(userImages).where(
    and(
      eq(userImages.userId, userId),
      notInArray(
        userImages.id,
        keep.map((k) => k.id),
      ),
    ),
  );
  return {
    id: (row as { id: string }).id,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    byteSize: image.data.length,
  };
}

export async function loadUserImage(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(userImages)
    .where(and(eq(userImages.id, id), eq(userImages.userId, userId)));
  return row;
}

/** 只认属于该用户的图片；有一张找不到就整体返回 undefined。 */
export async function loadChatImages(
  db: Db,
  userId: string,
  ids: string[],
): Promise<ChatImage[] | undefined> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(userImages)
    .where(and(eq(userImages.userId, userId), inArray(userImages.id, ids)));
  if (rows.length !== new Set(ids).size) return undefined;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => {
    const r = byId.get(id) as (typeof rows)[number];
    return { id: r.id, mimeType: r.mimeType, data: r.data.toString("base64") };
  });
}

export async function deleteUserImage(db: Db, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(userImages)
    .where(and(eq(userImages.id, id), eq(userImages.userId, userId)))
    .returning({ id: userImages.id });
  return rows.length > 0;
}
