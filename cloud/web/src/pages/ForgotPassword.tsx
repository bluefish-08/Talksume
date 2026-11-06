import { api } from "@talksume/web/api/client.ts";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import styles from "../auth/Auth.module.css";
import { AuthButton, AuthPage, FormError } from "../auth/AuthCard.tsx";
import { AuthField } from "../auth/AuthField.tsx";
import { useAuthConfig } from "../auth/api.ts";
import { emailError } from "../auth/validate.ts";

export function ForgotPasswordPage() {
  const config = useAuthConfig().data;
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const send = useMutation({
    mutationFn: (value: string) => api.post("/api/v1/auth/forgot-password", { email: value }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = emailError(email);
    setError(found);
    if (!found) send.mutate(email.trim());
  };

  if (config && !config.emailEnabled) {
    return (
      <AuthPage title="找回密码" footer={<Link to="/login">返回登录</Link>}>
        <p className={styles.notice}>当前没有开启邮件功能，请联系管理员为你重置密码。</p>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title="找回密码"
      lead="输入注册邮箱，我们会发送重置链接，1 小时内有效。"
      footer={<Link to="/login">返回登录</Link>}
    >
      {send.isSuccess ? (
        <p className={`${styles.notice} ${styles.success}`}>
          如果这个邮箱已注册，重置邮件已经发出，请查收。重置后所有设备都需要重新登录。
        </p>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          <AuthField label="邮箱" error={error}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </AuthField>
          <FormError error={send.error} />
          <AuthButton type="submit" disabled={send.isPending}>
            {send.isPending ? "发送中…" : "发送重置邮件"}
          </AuthButton>
        </form>
      )}
    </AuthPage>
  );
}
