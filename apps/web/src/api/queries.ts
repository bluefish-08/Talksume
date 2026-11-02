import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "./client.ts";
import type { ConversationSummary, NotificationList, ProfileResponse } from "./types.ts";

/** 全局 query key，跨页面失效时用这里的 key，避免拼错。 */
export const qk = {
  conversations: ["conversations"] as const,
  conversation: (id: string) => ["conversations", id] as const,
  profile: ["profile"] as const,
  resume: ["resume"] as const,
  notifications: ["notifications"] as const,
  matches: ["matches"] as const,
  jobs: ["jobs"] as const,
  applications: ["applications"] as const,
  llmOptions: ["llm-options"] as const,
};

export function useConversations() {
  return useQuery({
    queryKey: qk.conversations,
    queryFn: () => api.get<{ items: ConversationSummary[] }>("/api/v1/conversations").then((r) => r.items),
  });
}

export function useProfile() {
  return useQuery({ queryKey: qk.profile, queryFn: () => api.get<ProfileResponse>("/api/v1/profile") });
}

export function useNotifications() {
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => api.get<NotificationList>("/api/v1/notifications?limit=50"),
  });
}

export function useStartConversation() {
  const navigate = useNavigate();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ id: string; greeting: string }>("/api/v1/conversations"),
    onSuccess: ({ id }) => {
      void client.invalidateQueries({ queryKey: qk.conversations });
      navigate(`/c/${id}`);
    },
  });
}

export function useRenameConversation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch<ConversationSummary>(`/api/v1/conversations/${encodeURIComponent(id)}`, { title }),
    onMutate: ({ id, title }) =>
      client.setQueryData<ConversationSummary[]>(qk.conversations, (all) =>
        all?.map((c) => (c.id === id ? { ...c, title } : c)),
      ),
    onSettled: () => client.invalidateQueries({ queryKey: qk.conversations }),
  });
}

export function useDeleteConversation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/conversations/${encodeURIComponent(id)}`),
    onSuccess: (_, id) =>
      client.setQueryData<ConversationSummary[]>(qk.conversations, (all) => all?.filter((c) => c.id !== id)),
    onSettled: () => client.invalidateQueries({ queryKey: qk.conversations }),
  });
}

export function useRestoreConversation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ConversationSummary>(`/api/v1/conversations/${encodeURIComponent(id)}/restore`),
    onSettled: () => client.invalidateQueries({ queryKey: qk.conversations }),
  });
}
