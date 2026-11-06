import { api } from "@talksume/web/api/client.ts";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import styles from "../auth/Auth.module.css";
import { AuthButton, AuthPage, FormError } from "../auth/AuthCard.tsx";
import { AuthField, PasswordInput, useReveal } from "../auth/AuthField.tsx";
import { useRegister, useResendVerification } from "../auth/api.ts";
import { safeNext, withNext } from "../auth/redirect.ts";
import { emailError, newPasswordError } from "../auth/validate.ts";

export function RegisterPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const invite = params.get("invite") ?? undefined;
  const navigate = useNavigate();
  const register = useRegister();
  const resend = useResendVerification();
  const reveal = useReveal();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm?: string }>({});
  const [sentTo, setSentTo] = useState<string | null>(null);

  const inviteInfo = useQuery({
    queryKey: ["invite-peek", invite],
    enabled: !!invite,
    retry: false,
    queryFn: () =>
      api.get<{ email: string | null }>(
        `/api/v1/auth/invitations/peek?token=${encodeURIComponent(invite ?? "")}`,
      ),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = {
      email: emailError(email),
      password: newPasswordError(password),
      confirm: confirm === password ? undefined : "两次输入的密码不一致",
    };
    setErrors(found);
    if (found.email || found.password || found.confirm) return;
    register.mutate(
      {
        email: email.trim(),
        password,
        ...(name.trim() && { displayName: name.trim() }),
        ...(invite && { invitationToken: invite }),
      },
      {
        onSuccess: (res) => {
          if (!res?.user) return setSentTo(email.trim());
          navigate(invite && res.user.role === "hr" ? "/hr" : next, { replace: true });
        },
      },
    );
  };

  if (sentTo) {
    return (
      <AuthPage title="请查收验证邮件" footer={<Link to={withNext("/login", next)}>去登录</Link>}>
        <p className={styles.notice}>
          我们向 <strong>{sentTo}</strong> 发送了一封验证邮件，链接 24 小时内有效。验证完成后才能使用简聊。
        </p>
        <p className={styles.lead}>没收到？检查一下垃圾邮件，或者重新发送。</p>
        <FormError error={resend.error} />
        {resend.isSuccess && <p className={`${styles.notice} ${styles.success}`}>已重新发送，请稍候查收。</p>}
        <AuthButton variant="secondary" disabled={resend.isPending} onClick={() => resend.mutate(sentTo)}>
          重新发送验证邮件
        </AuthButton>
      </AuthPage>
    );
  }

  const inviteBlocked = !!invite && inviteInfo.isError;

  return (
    <AuthPage
      title="创建账号"
      lead="一个账号，管好你的简历和求职。"
      footer={
        <span>
          已有账号？<Link to={withNext("/login", next)}>登录</Link>
        </span>
      }
    >
      {invite && !inviteInfo.isError && (
        <p className={styles.notice}>你正在通过邀请注册 HR 账号，注册完成后自动开通 HR 工作台。</p>
      )}
      {inviteBlocked && (
        <p className={styles.error} role="alert">
          这个邀请已失效，请联系管理员重新生成。你也可以不带邀请注册普通账号。
        </p>
      )}
      <form className={styles.form} onSubmit={submit} noValidate>
        <AuthField label="邮箱" error={errors.email}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
          />
        </AuthField>
        <AuthField label="昵称" hint="选填">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="nickname"
            maxLength={60}
            placeholder="默认取邮箱前缀"
          />
        </AuthField>
        <AuthField label="密码" error={errors.password} hint="至少 8 位">
          <PasswordInput
            shown={reveal.shown}
            onToggle={reveal.toggle}
            placeholder="设置密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </AuthField>
        <AuthField label="确认密码" error={errors.confirm}>
          <PasswordInput
            shown={reveal.shown}
            placeholder="再输入一次"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </AuthField>
        <FormError error={register.error} />
        <AuthButton type="submit" disabled={register.isPending || inviteBlocked}>
          {register.isPending ? "提交中…" : "创建账号"}
        </AuthButton>
      </form>
    </AuthPage>
  );
}
