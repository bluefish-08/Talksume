import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useHr } from "./identity.tsx";
import type { HrApplication, HrApplicationDetail, HrJob, JobInput, StatusInput } from "./types.ts";

const key = (userId: string, ...rest: string[]) => ["hr", userId, ...rest] as const;

export function useHrJobs() {
  const { client, identity } = useHr();
  return useQuery({
    queryKey: key(identity.userId, "jobs"),
    queryFn: () => client.get<{ items: HrJob[] }>("/api/v1/hr/jobs").then((r) => r.items),
    retry: false,
  });
}

/** 演示场景里候选人在另一个窗口投递，所以列表轮询一下。 */
export function useHrApplications(jobId: string | null) {
  const { client, identity } = useHr();
  return useQuery({
    queryKey: key(identity.userId, "applications", jobId ?? ""),
    queryFn: () =>
      client
        .get<{ items: HrApplication[] }>(`/api/v1/hr/applications?jobId=${encodeURIComponent(jobId ?? "")}`)
        .then((r) => r.items),
    enabled: jobId !== null,
    refetchInterval: 10_000,
  });
}

export function useHrApplicationDetail(id: string) {
  const { client, identity } = useHr();
  const qc = useQueryClient();
  return useQuery({
    queryKey: key(identity.userId, "application", id),
    staleTime: 0,
    queryFn: async () => {
      const detail = await client.get<HrApplicationDetail>(`/api/v1/hr/applications/${id}`);
      // 打开详情会把 applied 推进到 viewed，列表也要跟着变
      void qc.invalidateQueries({ queryKey: key(identity.userId, "applications") });
      void qc.invalidateQueries({ queryKey: key(identity.userId, "jobs") });
      return detail;
    },
  });
}

export function useCreateJob() {
  const { client, identity } = useHr();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobInput) => client.post<{ job: HrJob }>("/api/v1/hr/jobs", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(identity.userId, "jobs") }),
  });
}

export function useSetStatus(id: string) {
  const { client, identity } = useHr();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StatusInput) =>
      client.post<HrApplicationDetail>(`/api/v1/hr/applications/${id}/status`, input),
    onSuccess: (detail) => {
      qc.setQueryData(key(identity.userId, "application", id), detail);
      void qc.invalidateQueries({ queryKey: key(identity.userId, "applications") });
      void qc.invalidateQueries({ queryKey: key(identity.userId, "jobs") });
    },
  });
}
