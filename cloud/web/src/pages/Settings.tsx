import { api } from "@talksume/web/api/client.ts";
import { useToast } from "@talksume/web/components/Toast.tsx";
import { Button } from "@talksume/web/components/ui.tsx";
import { Field } from "@talksume/web/features/hr/Field.tsx";
import { Modal } from "@talksume/web/features/jobs/Modal.tsx";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import styles from "../auth/Auth.module.css";
import { FormError } from "../auth/AuthCard.tsx";
import { ROLE_LABEL, useDeleteAccount, useLogout, useMe } from "../auth/api.ts";
import { newPasswordError } from "../auth/validate.ts";

export function SettingsPage() {
  const me = useMe().data;
  const logout = useLogout();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  if (!me) return null;

  return (
    <div className={styles.inShell}>
      <div className={`${styles.card} ${styles.wide}`}>
        <h1 className={styles.title}>账号设置</h1>
        <dl className={styles.rows}>
          <dt>邮箱</dt>
          <dd>{me.email}</dd>
          <dt>称呼</dt>
          <dd>{me.displayName ?? "—"}</dd>
          <dt>身份</dt>
          <dd>{ROLE_LABEL[me.role]}</dd>
        </dl>

        <ChangePassword />

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>退出登录</h2>
          <div className={styles.actions}>
            <Button
              disabled={logout.isPending}
              onClick={() =>
                logout.mutate(undefined, { onSuccess: () => navigate("/login", { replace: true }) })
              }
            >
              退出登录
            </Button>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>注销账号</h2>
          <p className={styles.lead}>
            删除账号和全部数据：对话、简历、投递记录、匹配结果都会被清除，无法恢复。
          </p>
          <div className={styles.actions}>
            <Button className={styles.danger} onClick={() => setDeleting(true)}>
              注销账号…
            </Button>
          </div>
        </section>
      </div>
      {deleting && <DeleteDialog email={me.email} onClose={() => setDeleting(false)} />}
    </div>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [oldPassword, setOld] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ old?: string; next?: string; confirm?: string }>({});
  const change = useMutation({
    mutationFn: () => api.post("/api/v1/auth/change-password", { oldPassword, newPassword: next }),
    onSuccess: () => {
      setOld("");
      setNext("");
      setConfirm("");
      toast("密码已修改，其他设备已退出登录", { tone: "success" });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = {
      old: oldPassword ? undefined : "请输入当前密码",
      next: newPasswordError(next),
      confirm: confirm === next ? undefined : "两次输入的密码不一致",
    };
    setErrors(found);
    if (!found.old && !found.next && !found.confirm) change.mutate();
  };

  return (
    <form className={`${styles.section} ${styles.form}`} onSubmit={submit} noValidate>
      <h2 className={styles.sectionTitle}>修改密码</h2>
      <Field label="当前密码" error={errors.old}>
        <input
          type="password"
          value={oldPassword}
          onChange={(e) => setOld(e.target.value)}
          autoComplete="current-password"
        />
      </Field>
      <div className={styles.inline}>
        <Field label="新密码" error={errors.next} hint="至少 8 位">
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="确认新密码" error={errors.confirm}>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
      </div>
      <FormError error={change.error} />
      <div className={styles.actions}>
        <Button type="submit" variant="dark" disabled={change.isPending}>
          {change.isPending ? "保存中…" : "修改密码"}
        </Button>
      </div>
    </form>
  );
}

function DeleteDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const navigate = useNavigate();
  const remove = useDeleteAccount();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const ready = password.length > 0 && confirmation.trim().toLowerCase() === email.toLowerCase();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready)
      remove.mutate({ password, confirmation }, { onSuccess: () => navigate("/login", { replace: true }) });
  };

  return (
    <Modal title="确认注销账号？" onClose={onClose}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.lead}>这个操作无法撤销。请输入账号邮箱 {email} 和密码确认。</p>
        <Field label="输入账号邮箱">
          <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="密码">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <FormError error={remove.error} />
        <div className={styles.actions}>
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="dark" disabled={!ready || remove.isPending}>
            {remove.isPending ? "删除中…" : "永久删除账号"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
