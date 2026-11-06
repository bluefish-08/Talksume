import { reportStatus, toApiError } from "./client.ts";

export interface UploadedImage {
  id: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  byteSize: number;
}

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(IMAGE_ACCEPT.split(","));

export const imageUrl = (id: string) => `/api/v1/images/${encodeURIComponent(id)}`;

/** 提交前先挡一遍；服务端按文件内容再判一次，这里只为少传一次。 */
export function checkImageFile(file: File): string | undefined {
  if (!TYPES.has(file.type)) return "只支持 PNG、JPEG、WebP 图片";
  if (file.size > IMAGE_MAX_BYTES) return `图片不能超过 ${IMAGE_MAX_BYTES / 1024 / 1024} MB`;
  return undefined;
}

export async function uploadImage(file: File, signal?: AbortSignal): Promise<UploadedImage> {
  const path = "/api/v1/images";
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": file.type, Accept: "application/json" },
    body: file,
  };
  if (signal) init.signal = signal;
  const res = await fetch(path, init);
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    reportStatus(res.status, path);
    throw toApiError(res.status, data);
  }
  return data as UploadedImage;
}

export async function deleteImage(id: string): Promise<void> {
  await fetch(imageUrl(id), { method: "DELETE" }).catch(() => undefined);
}
