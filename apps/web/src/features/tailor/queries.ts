import type { ResumeContent, TailorChange, TailorLevel } from "@talksume/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";

export interface TailoringView {
  available: boolean;
  job: { id: string; company: string; title: string };
  tailoring: {
    base: ResumeContent;
    changes: TailorChange[];
    /** 最近一次采用的调整。 */
    selected: string[];
    adopted: { resumeVersionId: string; adoptedAt: string } | null;
    /** 生成这份定制的对话；老数据为空。 */
    conversationId: string | null;
    /** 定制之后主简历又改过。 */
    stale: boolean;
    updatedAt: string;
  } | null;
}

export interface AdoptedTailoring {
  jobId: string;
  company: string;
  title: string;
  conversationId: string | null;
  resumeVersionId: string;
  adoptedAt: string;
}

export const tailoringsKey = ["tailorings"] as const;
export const tailoringKey = (jobId: string) => ["tailorings", "job", jobId] as const;
const urlOf = (jobId: string) => `/api/v1/jobs/${encodeURIComponent(jobId)}/tailoring`;

export function useTailoring(jobId: string | null | undefined) {
  return useQuery({
    queryKey: tailoringKey(jobId ?? ""),
    queryFn: ({ signal }) => api.get<TailoringView>(urlOf(jobId ?? ""), signal),
    enabled: !!jobId,
    retry: false,
  });
}

export function useAdoptedTailorings() {
  return useQuery({
    queryKey: [...tailoringsKey, "adopted"],
    queryFn: ({ signal }) =>
      api.get<{ items: AdoptedTailoring[] }>("/api/v1/tailorings", signal).then((r) => r.items),
  });
}

export function useTailorActions(jobId: string) {
  const client = useQueryClient();
  const onSuccess = (view: TailoringView) => {
    client.setQueryData(tailoringKey(jobId), view);
    void client.invalidateQueries({ queryKey: [...tailoringsKey, "adopted"] });
  };
  return {
    generate: useMutation({
      mutationFn: (level: TailorLevel) => api.post<TailoringView>(urlOf(jobId), { level }),
      onSuccess,
    }),
    adopt: useMutation({
      mutationFn: (changeIds: string[]) =>
        api.post<TailoringView & { adopted: number; rejected: number }>(`${urlOf(jobId)}/adopt`, {
          changeIds,
        }),
      onSuccess,
    }),
    revoke: useMutation({
      mutationFn: () => api.delete<TailoringView>(`${urlOf(jobId)}/adoption`),
      onSuccess,
    }),
  };
}
