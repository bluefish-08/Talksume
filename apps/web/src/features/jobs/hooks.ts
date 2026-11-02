import { keepPreviousData, skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
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
} from "./types.ts";

const API = "/api/v1";
const matchesKey = [...qk.matches, "page"] as const;
const refreshKey = [...qk.matches, "refresh-result"] as const;
const POLL_MS = 5_000;
const POLL_WINDOW_MS = 60_000;

/** 报告在刷新后台生成：前几名还没有报告时每 5 秒拉一次，最多一分钟。 */
export function useMatches() {
  const [polling, setPolling] = useState(true);
  const [round, setRound] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: round 变化时重新计时
  useEffect(() => {
    if (!polling) return;
    const t = setTimeout(() => setPolling(false), POLL_WINDOW_MS);
    return () => clearTimeout(t);
  }, [polling, round]);

  const query = useQuery({
    queryKey: matchesKey,
    queryFn: ({ signal }) => api.get<MatchList>(`${API}/matches?limit=100`, signal),
    refetchInterval: (q) => (polling && reportsPending(q.state.data?.items ?? []) ? POLL_MS : false),
  });

  const startPolling = useCallback(() => {
    setPolling(true);
    setRound((r) => r + 1);
  }, []);

  return { query, reportsPending: polling && reportsPending(query.data?.items ?? []), startPolling };
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
