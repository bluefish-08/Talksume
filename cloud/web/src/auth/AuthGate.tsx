import { setUnauthorizedHandler } from "@talksume/web/api/client.ts";
import { Spinner } from "@talksume/web/components/ui.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { Navigate, Outlet, useLocation, useSearchParams } from "react-router";
import styles from "./Auth.module.css";
import { meKey, useMe } from "./api.ts";
import { safeNext, withNext } from "./redirect.ts";

/** 业务接口一返回 401，就把登录态标成未登录，下面的 RequireAuth 会接着跳转。 */
export function UnauthorizedWatcher({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  useEffect(() => {
    setUnauthorizedHandler(() => qc.setQueryData(meKey, null));
    return () => setUnauthorizedHandler(() => {});
  }, [qc]);
  return children;
}

function Loading() {
  return (
    <div className={styles.loading}>
      <Spinner />
    </div>
  );
}

export function RequireAuth({ roles }: { roles?: readonly string[] }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Loading />;
  if (me.isError) {
    return (
      <div className={styles.loading}>
        <p>暂时连不上服务，请稍后刷新重试。</p>
      </div>
    );
  }
  const user = me.data;
  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={withNext("/login", next)} replace />;
  }
  if (!user.emailVerified) return <Navigate to="/verify-pending" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** 登录、注册这类页面：已登录就直接进业务页。 */
export function RedirectIfAuthed() {
  const me = useMe();
  const [params] = useSearchParams();
  if (me.isPending) return <Loading />;
  if (me.data?.emailVerified) {
    return <Navigate to={safeNext(params.get("next"), me.data.role === "hr" ? "/hr" : "/")} replace />;
  }
  return <Outlet />;
}

/** 单个页面的角色门，登录与验证状态由外层 RequireAuth 负责。 */
export function RequireRole({ roles, children }: { roles: readonly string[]; children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (!me.data || !roles.includes(me.data.role)) return <Navigate to="/" replace />;
  return children;
}
