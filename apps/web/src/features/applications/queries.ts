import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { qk } from "../../api/queries.ts";
import type { ApplicationDetail, Board } from "./types.ts";

export const detailKey = (id: string) => [...qk.applications, id] as const;

export function useBoard() {
  return useQuery({
    queryKey: qk.applications,
    queryFn: () => api.get<Board>("/api/v1/applications"),
  });
}

export function useApplicationDetail(id: string | null) {
  return useQuery({
    queryKey: detailKey(id ?? ""),
    queryFn: () => api.get<ApplicationDetail>(`/api/v1/applications/${id}`),
    enabled: id !== null,
  });
}

export type ApplicationAction =
  | { kind: "mark-applied" }
  | { kind: "withdraw" }
  | { kind: "status"; to: "viewed" | "interviewing" | "closed"; outcome?: "offer" | "rejected" };

export function useApplicationAction(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: ApplicationAction) => {
      const base = `/api/v1/applications/${id}`;
      if (action.kind === "status") {
        const { kind: _k, ...body } = action;
        return api.post<ApplicationDetail>(`${base}/status`, body);
      }
      return api.post<ApplicationDetail>(`${base}/${action.kind}`);
    },
    onSuccess: (detail) => {
      client.setQueryData(detailKey(id), detail);
      void client.invalidateQueries({ queryKey: qk.applications });
    },
  });
}
