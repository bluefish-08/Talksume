import { Spinner } from "@talksume/web/components/ui.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router";
import styles from "../auth/Auth.module.css";
import { AuthButton, AuthPage, FormError } from "../auth/AuthCard.tsx";
import { meKey, useLogout, useMe, useResendVerification } from "../auth/api.ts";

export function VerifyPendingPage() {
  const me = useMe();
  const qc = useQueryClient();
  const resend = useResendVerification();
  const logout = useLogout();

  if (me.isPending) return <Spinner />;
  if (!me.data) return <Navigate to="/login" replace />;
  if (me.data.emailVerified) return <Navigate to="/" replace />;

  return (
    <AuthPage title="请先验证邮箱" lead="验证完成前不能使用简聊的功能。">
      <p className={styles.notice}>
        验证邮件已发送到 <strong>{me.data.email}</strong>，点击邮件里的链接即可，24 小时内有效。
      </p>
      <FormError error={resend.error} />
      {resend.isSuccess && <p className={`${styles.notice} ${styles.success}`}>已重新发送，请稍候查收。</p>}
      <AuthButton disabled={resend.isPending} onClick={() => resend.mutate(undefined)}>
        重新发送验证邮件
      </AuthButton>
      <AuthButton variant="secondary" onClick={() => qc.invalidateQueries({ queryKey: meKey })}>
        我已验证，刷新状态
      </AuthButton>
      <div className={styles.footer}>
        <button type="button" className={styles.link} onClick={() => logout.mutate()}>
          退出登录
        </button>
      </div>
    </AuthPage>
  );
}
