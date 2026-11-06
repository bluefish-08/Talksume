import { Button } from "@talksume/web/components/ui.tsx";
import { Field } from "@talksume/web/features/hr/Field.tsx";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import styles from "../auth/Auth.module.css";
import { AuthPage, FormError } from "../auth/AuthCard.tsx";
import { useAuthConfig, useLogin } from "../auth/api.ts";
import { safeNext, withNext } from "../auth/redirect.ts";
import { emailError } from "../auth/validate.ts";

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"), "");
  const navigate = useNavigate();
  const login = useLogin();
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
      title="登录"
      lead="登录后继续你的简历和求职进度。"
      footer={
        <>
          <Link to={withNext("/register", next || "/")}>没有账号？注册</Link>
          {config?.emailEnabled && <Link to="/forgot-password">忘记密码</Link>}
          {config && !config.emailEnabled && <span>忘记密码？请联系管理员重置</span>}
        </>
      }
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label="邮箱" error={errors.email}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            // biome-ignore lint/a11y/noAutofocus: 登录页的唯一任务就是填这个框
            autoFocus
          />
        </Field>
        <Field label="密码" error={errors.password}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <FormError error={login.error} />
        <Button type="submit" variant="dark" size="lg" disabled={login.isPending}>
          {login.isPending ? "登录中…" : "登录"}
        </Button>
      </form>
    </AuthPage>
  );
}
