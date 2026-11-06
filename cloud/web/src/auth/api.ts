import { ApiError, api } from "@talksume/web/api/client.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type Role = "seeker" | "hr" | "admin";

export interface AccountUser {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  emailVerified: boolean;
}

export const ROLE_LABEL: Record<Role, string> = { seeker: "求职者", hr: "HR", admin: "管理员" };

export const meKey = ["auth", "me"] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<AccountUser | null> => {
      try {
        return (await api.get<{ user: AccountUser }>("/api/v1/auth/me")).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

/** 换账号、退出、注销后，上一个账号的缓存一律丢掉。 */
function useResetCache() {
  const qc = useQueryClient();
  return (user: AccountUser | null) => {
    qc.clear();
    qc.setQueryData(meKey, user);
  };
}

export function useLogin() {
  const reset = useResetCache();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api.post<{ user: AccountUser }>("/api/v1/auth/login", input),
    onSuccess: (res) => reset(res.user),
  });
}

export function useLogout() {
  const reset = useResetCache();
  return useMutation({
    mutationFn: () => api.post("/api/v1/auth/logout"),
    onSettled: () => reset(null),
  });
}

export function useAuthConfig() {
  return useQuery({
    queryKey: ["auth", "config"],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => api.get<{ emailEnabled: boolean }>("/api/v1/auth/config"),
  });
}

/** 关邮件时注册接口直接返回已登录的账号，开邮件时返回 202（要先去邮箱验证）。 */
export function useRegister() {
  const reset = useResetCache();
  return useMutation({
    mutationFn: (input: {
      email: string;
      password: string;
      displayName?: string;
      invitationToken?: string;
    }) => api.post<{ user?: AccountUser } | undefined>("/api/v1/auth/register", input),
    onSuccess: (res) => {
      if (res?.user) reset(res.user);
    },
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: (email?: string) => api.post("/api/v1/auth/resend-verification", email ? { email } : {}),
  });
}

export function useDeleteAccount() {
  const reset = useResetCache();
  return useMutation({
    mutationFn: (input: { password: string; confirmation: string }) =>
      api.post("/api/v1/auth/delete-account", input),
    onSuccess: () => reset(null),
  });
}

export interface Invitation {
  id: string;
  email: string | null;
  note: string | null;
  status: "pending" | "used" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedByEmail: string | null;
}

export const invitationsKey = ["admin", "hr-invitations"] as const;

export function useInvitations() {
  return useQuery({
    queryKey: invitationsKey,
    queryFn: () => api.get<{ items: Invitation[] }>("/api/v1/admin/hr-invitations").then((r) => r.items),
  });
}
