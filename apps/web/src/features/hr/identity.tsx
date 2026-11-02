import { createContext, type ReactNode, useContext, useMemo } from "react";
import { apiAs } from "../../api/client.ts";

const ID_KEY = "talksume.hrUserId";
const PROFILE_KEY = "talksume.hrProfile";

export interface HrIdentity {
  userId: string;
  displayName: string;
  company: string;
}

export function loadIdentity(): HrIdentity | null {
  try {
    const userId = localStorage.getItem(ID_KEY);
    if (!userId) return null;
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}") as Partial<HrIdentity>;
    return { userId, displayName: profile.displayName ?? "HR", company: profile.company ?? "" };
  } catch {
    return null;
  }
}

export function saveIdentity(identity: HrIdentity): void {
  try {
    localStorage.setItem(ID_KEY, identity.userId);
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ displayName: identity.displayName, company: identity.company }),
    );
  } catch {
    // 无痕模式下存不了：本次会话内仍可用
  }
}

export function clearIdentity(): void {
  try {
    localStorage.removeItem(ID_KEY);
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    // 同上
  }
}

interface HrContextValue {
  identity: HrIdentity;
  client: ReturnType<typeof apiAs>;
  signOut: () => void;
}

const HrContext = createContext<HrContextValue | null>(null);

export function HrProvider({
  identity,
  signOut,
  children,
}: {
  identity: HrIdentity;
  signOut: () => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ identity, signOut, client: apiAs(identity.userId) }), [identity, signOut]);
  return <HrContext.Provider value={value}>{children}</HrContext.Provider>;
}

export function useHr(): HrContextValue {
  const value = useContext(HrContext);
  if (!value) throw new Error("useHr 必须在 HrProvider 内使用");
  return value;
}
