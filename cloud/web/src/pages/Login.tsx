import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import styles from "../auth/Auth.module.css";
import { AuthButton, AuthPage, FormError } from "../auth/AuthCard.tsx";
import { AuthField, PasswordInput, useReveal } from "../auth/AuthField.tsx";
import { useAuthConfig, useLogin } from "../auth/api.ts";
import { safeNext, withNext } from "../auth/redirect.ts";
import { emailError } from "../auth/validate.ts";

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"), "");
  const navigate = useNavigate();
  const login = useLogin();
  const reveal = useReveal();
  const config = useAuthConfig().data;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = {
      email: emailError(email),
      password: password ? undefined : "请输入密码",
    };
    setErrors(found);
    if (found.email || found.password) return;
    login.mutate(
      { email: email.trim(), password },
      {
        onSuccess: ({ user }) => {
          if (!user.emailVerified) navigate("/verify-pending", { replace: true });
          else navigate(next || (user.role === "hr" ? "/hr" : "/"), { replace: true });
        },
      },
    );
  };

  return (
    <AuthPage
      title="登录简聊"
      lead="继续你的简历和求职进度。"
      footer={
        <>
          <span>
            还没有账号？<Link to={withNext("/register", next || "/")}>创建一个</Link>
          </span>
          {config?.emailEnabled && <Link to="/forgot-password">忘记密码</Link>}
          {config && !config.emailEnabled && <span>忘记密码请联系管理员</span>}
        </>
      }
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <AuthField label="邮箱" error={errors.email}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            // biome-ignore lint/a11y/noAutofocus: 登录页的唯一任务就是填这个框
            autoFocus
          />
        </AuthField>
        <AuthField label="密码" error={errors.password}>
          <PasswordInput
            shown={reveal.shown}
            onToggle={reveal.toggle}
            placeholder="输入密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </AuthField>
        <FormError error={login.error} />
        <AuthButton type="submit" disabled={login.isPending}>
          {login.isPending ? "登录中…" : "登录"}
        </AuthButton>
      </form>
    </AuthPage>
  );
}
