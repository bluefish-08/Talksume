import { keepPreviousData, skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../../api/client.ts";
import { qk } from "../../api/queries.ts";
import { reportsPending } from "./format.ts";
import type {
  ApplicationBoard,
  ApplicationRef,
  CreatedApplication,
  FeedbackSignal,
  ImportResult,
  JobDetail,
  JobList,
  MatchList,
  RefreshResult,
  ReportStatus,
} from "./types.ts";

const API = "/api/v1";
const matchesKey = [...qk.matches, "page"] as const;
const refreshKey = [...qk.matches, "refresh-result"] as const;
const POLL_MS = 4_000;

/** 报告在刷新后台逐个生成：服务端标记 pending 时每 4 秒拉一次；服务端会把超时/失败标成 failed，不会无限等。 */
export function useMatches() {
  const query = useQuery({
    queryKey: matchesKey,
    queryFn: ({ signal }) => api.get<MatchList>(`${API}/matches?limit=100`, signal),
    refetchInterval: (q) => (reportsPending(q.state.data?.items ?? []) ? POLL_MS : false),
  });
  return { query, reportsPending: reportsPending(query.data?.items ?? []) };
}

export function useRetryReport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      api.post<{ jobId: string; reportStatus: ReportStatus }>(
        `${API}/jobs/${encodeURIComponent(jobId)}/report`,
        {},
      ),
    onSuccess: (_, jobId) => {
      client.setQueryData<MatchList>(
        matchesKey,
        (old) =>
          old && {
            ...old,
            items: old.items.map((m) => (m.jobId === jobId ? { ...m, reportStatus: "pending" } : m)),
          },
      );
    },
  });
}

export function useRefreshResult() {
  return useQuery<RefreshResult | null>({
    queryKey: refreshKey,
    queryFn: skipToken,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRefreshMatches() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RefreshResult>(`${API}/matches/refresh`, {}),
    onSuccess: async (result) => {
      client.setQueryData(refreshKey, result);
      await client.invalidateQueries({ queryKey: matchesKey });
    },
  });
}

export function useJobSearch(q: string) {
  return useQuery({
    queryKey: [...qk.jobs, "search", q],
    queryFn: ({ signal }) => api.get<JobList>(`${API}/jobs?q=${encodeURIComponent(q)}&pageSize=50`, signal),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useJobDetail(id: string | null) {
  return useQuery({
    queryKey: [...qk.jobs, "detail", id],
    queryFn: id
      ? ({ signal }) => api.get<JobDetail>(`${API}/jobs/${encodeURIComponent(id)}`, signal)
      : skipToken,
    retry: false,
  });
}

export function useAppliedJobs() {
  return useQuery({
    queryKey: [...qk.applications, "by-job"],
    queryFn: ({ signal }) => api.get<ApplicationBoard>(`${API}/applications`, signal),
    select: (board) => {
      const byJob = new Map<string, ApplicationRef>();
      for (const rows of Object.values(board.columns)) for (const a of rows) byJob.set(a.job.id, a);
      return byJob;
    },
  });
}

export function useFeedback() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, signal }: { jobId: string; signal: FeedbackSignal }) =>
      api.post(`${API}/jobs/${encodeURIComponent(jobId)}/feedback`, { signal }),
    onSuccess: (_, { jobId, signal }) => {
      client.setQueryData<MatchList>(
        matchesKey,
        (old) =>
          old && {
            ...old,
            items: old.items.map((m) => (m.jobId === jobId ? { ...m, feedback: signal } : m)),
          },
      );
    },
  });
}

export function useCreateApplication() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.post<CreatedApplication>(`${API}/applications`, { jobId }),
    onSettled: () => client.invalidateQueries({ queryKey: qk.applications }),
  });
}

export function useMarkApplied() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (applicationId: string) => api.post(`${API}/applications/${applicationId}/mark-applied`, {}),
    onSettled: () => client.invalidateQueries({ queryKey: qk.applications }),
  });
}

export function useImportJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string; url?: string }) => api.post<ImportResult>(`${API}/jobs/import`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: matchesKey }),
  });
}

export function useOptimizeResume() {
  const navigate = useNavigate();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (job: { company: string; title: string }) => {
      const { id } = await api.post<{ id: string }>(`${API}/conversations`);
      return { id, job };
    },
    onSuccess: ({ id, job }) => {
      void client.invalidateQueries({ queryKey: qk.conversations });
      navigate(`/c/${id}`, {
        state: {
          initialMessage: `我想投递${job.company}的「${job.title}」，帮我看看简历针对这个岗位还缺什么`,
        },
      });
    },
  });
}
