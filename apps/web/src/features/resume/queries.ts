import { DEFAULT_RESUME_STYLE, type ResumeStyle } from "@talksume/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { ApiError, api, request, toApiError } from "../../api/client.ts";
import { qk } from "../../api/queries.ts";
import type { ResumeContent } from "../../api/types.ts";
import { useToast } from "../../components/Toast.tsx";

export interface FactItem {
  id: string;
  section: string;
  quote: string;
  sourceMessageId: string | null;
  /** resume：导入简历时从原文摘出的；旧后端不返回时按对话处理。 */
  source?: "chat" | "resume";
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
    queryFn: () =>
      api.get<{ resume: ResumeContent; profileVersion: number; updatedAt?: string | null }>("/api/v1/resume"),
  });
}

export const resumeStyleKey = ["resume-style"] as const;

export function useResumeStyle() {
  const query = useQuery({
    queryKey: resumeStyleKey,
    queryFn: () => api.get<{ style: ResumeStyle }>("/api/v1/resume/style").then((r) => r.style),
  });
  return { ...query, style: query.data ?? DEFAULT_RESUME_STYLE };
}

/** 先乐观切换预览，保存失败再退回并提示。 */
export function useSaveResumeStyle() {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (style: ResumeStyle) =>
      request<{ style: ResumeStyle }>("PUT", "/api/v1/resume/style", style).then((r) => r.style),
    onMutate: async (style) => {
      await client.cancelQueries({ queryKey: resumeStyleKey });
      const previous = client.getQueryData<ResumeStyle>(resumeStyleKey);
      client.setQueryData(resumeStyleKey, style);
      return { previous };
    },
    onError: (error, _style, context) => {
      if (context?.previous) client.setQueryData(resumeStyleKey, context.previous);
      toast(error instanceof ApiError ? error.message : "模板保存失败，请稍后再试", { tone: "error" });
    },
    onSuccess: (style) => client.setQueryData(resumeStyleKey, style),
  });
}

export interface StyleRecommendation extends ResumeStyle {
  reason: string;
}

export function useRecommendStyle() {
  return useMutation({
    mutationFn: () =>
      api
        .post<{ recommendation: StyleRecommendation }>("/api/v1/resume/style/recommend")
        .then((r) => r.recommendation),
  });
}

export type ExportFormat = "pdf" | "docx";

/** 简历操作按钮的尺寸：对话页简历栏用 sm，简历页页头用 md。 */
export type TriggerSize = "sm" | "md";

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
  const { style } = useResumeStyle();
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const exportAs = useCallback(
    async (format: ExportFormat, version?: string) => {
      setBusy(format);
      try {
        // 有对话定制的主题时不带预设参数，服务端按保存的样式导出
        const params = new URLSearchParams(
          style.theme ? { format } : { format, template: style.template, accent: style.accent },
        );
        if (version) params.set("version", version);
        const res = await fetch(`/api/v1/resume/export?${params}`);
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
    [toast, style],
  );

  return { exportAs, busy };
}
