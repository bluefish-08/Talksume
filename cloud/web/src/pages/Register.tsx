import { api } from "@talksume/web/api/client.ts";
import { Button } from "@talksume/web/components/ui.tsx";
import { Field } from "@talksume/web/features/hr/Field.tsx";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import styles from "../auth/Auth.module.css";
import { AuthPage, FormError } from "../auth/AuthCard.tsx";
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
        <Button disabled={resend.isPending} onClick={() => resend.mutate(sentTo)}>
          重新发送验证邮件
        </Button>
      </AuthPage>
    );
  }

  const inviteBlocked = !!invite && inviteInfo.isError;

  return (
    <AuthPage
      title="注册"
      lead="用邮箱创建账号，和助手聊几句就能生成简历。"
      footer={<Link to={withNext("/login", next)}>已有账号？登录</Link>}
    >
      {invite && !inviteInfo.isError && (
        <p className={styles.notice}>你正在通过邀请注册 HR 账号，验证邮箱后自动开通。</p>
      )}
      {inviteBlocked && (
        <p className={styles.error} role="alert">
          这个邀请已失效，请联系管理员重新生成。你也可以不带邀请注册普通账号。
        </p>
      )}
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label="邮箱" error={errors.email}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <Field label="称呼" hint="选填，默认取邮箱前缀">
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} />
        </Field>
        <Field label="密码" error={errors.password} hint="至少 8 位">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="确认密码" error={errors.confirm}>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <FormError error={register.error} />
        <Button type="submit" variant="dark" size="lg" disabled={register.isPending || inviteBlocked}>
          {register.isPending ? "提交中…" : "注册"}
        </Button>
      </form>
    </AuthPage>
  );
}
