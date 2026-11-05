import { api, toApiError } from "../../api/client.ts";
import type { ProfileSection } from "../../api/types.ts";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_CHARS = 12_000;
export const ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface ImportFact {
  section: ProfileSection;
  payload: Record<string, unknown>;
  quote: string;
}

export type ImportItemStatus = "new" | "update" | "exists" | "conflict";

export interface ImportPreview {
  source: { kind: "paste" | "pdf" | "docx"; fileName?: string; chars: number };
  text: string;
  items: { fact: ImportFact; label: string; status: ImportItemStatus }[];
  groups: { section: ProfileSection; label: string; items: string[] }[];
  dropped: { section: ProfileSection; label: string; field?: string; reason: string }[];
}

export interface ImportResult {
  conversationId: string;
  imported: number;
  conflicts: number;
}

/** 前端先拦一道，免得大文件白传一趟。 */
export function checkFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".doc")) return "暂不支持老版 .doc，请另存为 .docx 或 PDF，或直接粘贴文本";
  if (!name.endsWith(".pdf") && !name.endsWith(".docx")) return "只支持 PDF 和 Word（.docx）文件";
  if (file.size > MAX_FILE_BYTES) return "文件超过 5MB，请压缩后再上传，或直接粘贴文本";
  return null;
}

export async function parseFile(file: File, signal?: AbortSignal): Promise<ImportPreview> {
  const type = file.name.toLowerCase().endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const res = await fetch("/api/v1/resume-import/parse", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": type,
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
    ...(signal && { signal }),
  });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw toApiError(res.status, data);
  return data as ImportPreview;
}

export const parseText = (text: string, signal?: AbortSignal) =>
  api.post<ImportPreview>("/api/v1/resume-import/parse", { text }, signal);

export const confirmImport = (body: {
  text: string;
  fileName?: string;
  facts: ImportFact[];
  conversationId?: string;
}) => api.post<ImportResult>("/api/v1/resume-import/confirm", body);
