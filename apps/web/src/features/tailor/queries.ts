import type { ResumeContent, TailorChange, TailorLevel } from "@talksume/core";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import type { TailorCard } from "../chat/types.ts";

export interface TailoringView {
  available: boolean;
  job: { id: string; company: string; title: string };
  tailoring: {
    base: ResumeContent;
    changes: TailorChange[];
    /** 最近一次采用的调整。 */
    selected: string[];
    /** 用户已经改回主简历；再生成或再选中会清掉。 */
    revoked: boolean;
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

/** 流式 update 事件只有卡片快照；先按它乐观补缓存，再后台拉完整视图校准。 */
export function applyTailorUpdate(client: QueryClient, card: TailorCard): void {
  const key = tailoringKey(card.jobId);
  const current = client.getQueryData<TailoringView>(key);
  if (current?.tailoring) {
    const status = card.status;
    const selected = card.items?.filter((item) => item.selected && !item.blocked).map((item) => item.id);
    const now = new Date().toISOString();
    const revoked =
      status === "revoked"
        ? true
        : status === "draft" || status === "adopted"
          ? false
          : current.tailoring.revoked;
    const adopted =
      status === "revoked"
        ? null
        : status === "adopted"
          ? (current.tailoring.adopted ?? { resumeVersionId: "", adoptedAt: now })
          : current.tailoring.adopted;
    client.setQueryData<TailoringView>(key, {
      ...current,
      tailoring: {
        ...current.tailoring,
        selected: status === "revoked" ? [] : (selected ?? current.tailoring.selected),
        revoked,
        adopted,
        updatedAt: now,
      },
    });
  }
  void client.invalidateQueries({ queryKey: key });
  void client.invalidateQueries({ queryKey: [...tailoringsKey, "adopted"] });
}

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
    void client.invalidateQueries({ queryKey: tailoringKey(jobId) });
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
