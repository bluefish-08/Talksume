import type { InterviewQuestion, InterviewSessionState, ResumeSource } from "@talksume/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";

export interface PrepView {
  available: boolean;
  job: { id: string; company: string; title: string };
  nextSource: ResumeSource;
  prep: {
    resumeSource: ResumeSource;
    questions: InterviewQuestion[];
    model: string | null;
    updatedAt: string;
    stale: boolean;
  } | null;
  sessions: { id: string; status: "active" | "finished"; answered: number; updatedAt: string }[];
}

export interface SessionView {
  id: string;
  jobId: string;
  state: InterviewSessionState;
  questions: InterviewQuestion[];
  updatedAt: string;
}

export const interviewPath = (jobId: string) => `/interview/${encodeURIComponent(jobId)}`;
const prepKey = (jobId: string) => ["interview", "prep", jobId] as const;
const sessionKey = (id: string) => ["interview", "session", id] as const;
const jobUrl = (jobId: string) => `/api/v1/jobs/${encodeURIComponent(jobId)}`;

export function usePrep(jobId: string) {
  return useQuery({
    queryKey: prepKey(jobId),
    queryFn: ({ signal }) => api.get<PrepView>(`${jobUrl(jobId)}/interview-prep`, signal),
    enabled: !!jobId,
    retry: false,
  });
}

export function useGeneratePrep(jobId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrepView>(`${jobUrl(jobId)}/interview-prep`),
    onSuccess: (view) => client.setQueryData(prepKey(jobId), view),
  });
}

export function useStartSession(jobId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<SessionView>(`${jobUrl(jobId)}/interview-sessions`),
    onSuccess: (view) => {
      client.setQueryData(sessionKey(view.id), view);
      void client.invalidateQueries({ queryKey: prepKey(jobId) });
    },
  });
}

export function useSession(id: string | null) {
  return useQuery({
    queryKey: sessionKey(id ?? ""),
    queryFn: ({ signal }) => api.get<SessionView>(`/api/v1/interview-sessions/${id}`, signal),
    enabled: !!id,
    retry: false,
  });
}

export function useSessionActions(id: string, jobId: string) {
  const client = useQueryClient();
  const onSuccess = (view: SessionView) => {
    client.setQueryData(sessionKey(id), view);
    void client.invalidateQueries({ queryKey: prepKey(jobId) });
  };
  return {
    answer: useMutation({
      mutationFn: (text: string) =>
        api.post<SessionView>(`/api/v1/interview-sessions/${id}/answer`, { text }),
      onSuccess,
    }),
    finish: useMutation({
      mutationFn: () => api.post<SessionView>(`/api/v1/interview-sessions/${id}/finish`),
      onSuccess,
    }),
  };
}

/** 新经历点「补充到画像」时，开一段建档对话并带上原话，由建档 agent 按原有规则写入。 */
export function useStartIntake() {
  return useMutation({
    mutationFn: (message: string) =>
      api.post<{ id: string }>("/api/v1/conversations").then((c) => ({ id: c.id, message })),
  });
}
