import { createContext, type ReactNode, useContext, useMemo } from "react";
import { api } from "../../api/client.ts";
import { getExtensions } from "../../extensions.ts";

export interface HrIdentity {
  userId: string;
  displayName: string;
  company: string;
}

interface HrContextValue {
  identity: HrIdentity;
  client: typeof api;
  /** 没有登录系统（本地版）时为空，页面不显示退出按钮。 */
  signOut: (() => void) | undefined;
}

const HrContext = createContext<HrContextValue | null>(null);

/** HR 身份来自部署版注册的登录态；本地版没有登录，用固定的本机身份。 */
export function HrProvider({ children }: { children: ReactNode }) {
  const { useAccount, useLogout } = getExtensions();
  const account = useAccount?.() ?? null;
  const logout = useLogout?.();
  const value = useMemo<HrContextValue>(
    () => ({
      identity: {
        userId: account?.id ?? "local",
        displayName: account?.displayName ?? account?.email ?? "本机用户",
        company: "",
      },
      client: api,
      signOut: logout,
    }),
    [account, logout],
  );
  return <HrContext.Provider value={value}>{children}</HrContext.Provider>;
}

export function useHr(): HrContextValue {
  const value = useContext(HrContext);
  if (!value) throw new Error("useHr 必须在 HrProvider 内使用");
  return value;
}
