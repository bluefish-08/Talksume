import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { ApiError, api, toApiError } from "../../api/client.ts";
import { qk } from "../../api/queries.ts";
import type { ResumeContent } from "../../api/types.ts";
import { useToast } from "../../components/Toast.tsx";

export interface FactItem {
  id: string;
  section: string;
  quote: string;
  sourceMessageId: string | null;
  status: "pending" | "confirmed" | "superseded";
  createdAt: string;
}

export const factsKey = ["facts"] as const;

/** 旧后端没有 /facts 时按空列表处理，溯源功能自然隐藏。 */
export function useFacts() {
  return useQuery({
    queryKey: factsKey,
    retry: false,
    queryFn: () =>
      api.get<{ items: FactItem[] }>("/api/v1/facts").then(
        (r) => r.items,
        (error: unknown) => {
          if (error instanceof ApiError && error.status === 404) return [];
          throw error;
        },
      ),
  });
}

export function useResume() {
  return useQuery({
    queryKey: qk.resume,
    queryFn: () => api.get<{ resume: ResumeContent; profileVersion: number }>("/api/v1/resume"),
  });
}

export type ExportFormat = "pdf" | "docx";

function filenameOf(header: string | null, fallback: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header ?? "")?.[1];
  if (!encoded) return fallback;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return fallback;
  }
}

/** 用 fetch 取文件，失败时把服务端的错误说明弹出来，而不是下载一个 JSON。 */
export function useExportResume() {
  const toast = useToast();
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const exportAs = useCallback(
    async (format: ExportFormat) => {
      setBusy(format);
      try {
        const res = await fetch(`/api/v1/resume/export?format=${format}`);
        if (!res.ok) {
          const text = await res.text();
          let body: unknown;
          try {
            body = text ? JSON.parse(text) : undefined;
          } catch {
            body = undefined;
          }
          throw toApiError(res.status, body);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filenameOf(res.headers.get("content-disposition"), `简历.${format}`);
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch (error) {
        toast(error instanceof ApiError ? error.message : "导出失败，请稍后再试", { tone: "error" });
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  return { exportAs, busy };
}
