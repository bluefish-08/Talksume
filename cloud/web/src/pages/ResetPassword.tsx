import { api } from "@talksume/web/api/client.ts";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router";
import styles from "../auth/Auth.module.css";
import { AuthButton, AuthPage, FormError } from "../auth/AuthCard.tsx";
import { AuthField, PasswordInput, useReveal } from "../auth/AuthField.tsx";
import { newPasswordError } from "../auth/validate.ts";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const reveal = useReveal();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const reset = useMutation({
    mutationFn: (value: string) => api.post("/api/v1/auth/reset-password", { token, password: value }),
  });

  if (!token) {
    return (
      <AuthPage title="链接不完整" footer={<Link to="/forgot-password">重新获取重置邮件</Link>}>
        <p>请回到邮件里重新点击链接。</p>
      </AuthPage>
    );
  }

  if (reset.isSuccess) {
    return (
      <AuthPage title="密码已重置" lead="所有设备已退出登录，请用新密码重新登录。">
        <Link to="/login">去登录</Link>
      </AuthPage>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = {
      password: newPasswordError(password),
      confirm: confirm === password ? undefined : "两次输入的密码不一致",
    };
    setErrors(found);
    if (!found.password && !found.confirm) reset.mutate(password);
  };

  return (
    <AuthPage title="设置新密码" footer={<Link to="/forgot-password">链接失效？重新获取</Link>}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <AuthField label="新密码" error={errors.password} hint="至少 8 位">
          <PasswordInput
            shown={reveal.shown}
            onToggle={reveal.toggle}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </AuthField>
        <AuthField label="确认新密码" error={errors.confirm}>
          <PasswordInput
            shown={reveal.shown}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </AuthField>
        <FormError error={reset.error} />
        <AuthButton type="submit" disabled={reset.isPending}>
          {reset.isPending ? "提交中…" : "重置密码"}
        </AuthButton>
      </form>
    </AuthPage>
  );
}
