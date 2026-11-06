import { api } from "@talksume/web/api/client.ts";
import { Spinner } from "@talksume/web/components/ui.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AuthPage } from "../auth/AuthCard.tsx";
import { meKey } from "../auth/api.ts";

type State = { kind: "working" } | { kind: "ok" } | { kind: "failed"; message: string };

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const qc = useQueryClient();
  const started = useRef(false);
  const [state, setState] = useState<State>(
    token ? { kind: "working" } : { kind: "failed", message: "链接不完整，请回到邮件里重新点击。" },
  );

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api.post("/api/v1/auth/verify-email", { token }).then(
      () => {
        setState({ kind: "ok" });
        void qc.invalidateQueries({ queryKey: meKey });
      },
      (err: Error) => setState({ kind: "failed", message: err.message }),
    );
  }, [token, qc]);

  if (state.kind === "working") {
    return (
      <AuthPage title="正在验证邮箱…">
        <Spinner />
      </AuthPage>
    );
  }
  if (state.kind === "ok") {
    return (
      <AuthPage title="邮箱已验证" lead="现在可以登录并使用简聊了。">
        <Link to="/login">去登录</Link>
      </AuthPage>
    );
  }
  return (
    <AuthPage title="验证没有成功" lead={state.message}>
      <p>链接可能已经用过或过期。如果你已经验证过，直接登录就行；否则登录后可以重新发送验证邮件。</p>
      <Link to="/login">去登录</Link>
    </AuthPage>
  );
}
