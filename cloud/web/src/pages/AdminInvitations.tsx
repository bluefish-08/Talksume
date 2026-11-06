import { api } from "@talksume/web/api/client.ts";
import { useToast } from "@talksume/web/components/Toast.tsx";
import { Button, Spinner } from "@talksume/web/components/ui.tsx";
import { Field } from "@talksume/web/features/hr/Field.tsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import styles from "../auth/Auth.module.css";
import { FormError } from "../auth/AuthCard.tsx";
import { type Invitation, invitationsKey, useInvitations } from "../auth/api.ts";
import { emailError } from "../auth/validate.ts";

const STATUS: Record<Invitation["status"], { label: string; cls: string }> = {
  pending: { label: "待使用", cls: styles.badgePending ?? "" },
  used: { label: "已使用", cls: styles.badgeUsed ?? "" },
  expired: { label: "已过期", cls: styles.badgeOff ?? "" },
  revoked: { label: "已撤销", cls: styles.badgeOff ?? "" },
};

const TTL_OPTIONS = [
  { hours: 24, label: "1 天" },
  { hours: 72, label: "3 天" },
  { hours: 168, label: "7 天" },
  { hours: 720, label: "30 天" },
];

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function AdminInvitationsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useInvitations();
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [ttl, setTtl] = useState(72);
  const [emailErr, setEmailErr] = useState<string>();
  const [link, setLink] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ link: string }>("/api/v1/admin/hr-invitations", {
        ttlHours: ttl,
        ...(note.trim() && { note: note.trim() }),
        ...(email.trim() && { email: email.trim() }),
      }),
    onSuccess: (res) => {
      setLink(res.link);
      setNote("");
      setEmail("");
      void qc.invalidateQueries({ queryKey: invitationsKey });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/admin/hr-invitations/${id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitationsKey }),
    onError: (err: Error) => toast(err.message, { tone: "error" }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = email.trim() ? emailError(email) : undefined;
    setEmailErr(found);
    if (!found) create.mutate();
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast("链接已复制", { tone: "success" });
    } catch {
      toast("复制失败，请手动选中链接复制", { tone: "error" });
    }
  };

  return (
    <div className={styles.inShell}>
      <div className={`${styles.card} ${styles.wide}`}>
        <h1 className={styles.title}>HR 邀请</h1>
        <p className={styles.lead}>
          生成一次性邀请链接发给 HR。链接只在生成时显示一次，用过或过期后失效，也可以随时撤销。
        </p>

        <form className={styles.form} onSubmit={submit} noValidate>
          <div className={styles.inline}>
            <Field label="备注" hint="选填，例如公司名">
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            </Field>
            <Field label="限定邮箱" hint="选填，填了只有该邮箱能使用" error={emailErr}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="有效期">
              <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
                {TTL_OPTIONS.map((o) => (
                  <option key={o.hours} value={o.hours}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <FormError error={create.error} />
          <div className={styles.actions}>
            <Button type="submit" variant="dark" disabled={create.isPending}>
              {create.isPending ? "生成中…" : "生成邀请链接"}
            </Button>
          </div>
        </form>

        {link && (
          <div className={styles.section}>
            <p className={`${styles.notice} ${styles.success}`}>
              邀请链接已生成，离开页面后无法再次查看，请现在复制。
            </p>
            <div className={styles.linkBox}>
              <input readOnly value={link} aria-label="邀请链接" onFocus={(e) => e.currentTarget.select()} />
              <Button size="sm" onClick={copy}>
                复制
              </Button>
            </div>
          </div>
        )}

        <ResetUserPassword />

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>全部邀请</h2>
          {list.isPending && <Spinner />}
          {list.isError && <p className={styles.error}>加载失败，请刷新重试。</p>}
          {list.data?.length === 0 && <p className={styles.lead}>还没有邀请。</p>}
          {!!list.data?.length && (
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>备注 / 限定邮箱</th>
                    <th>创建</th>
                    <th>过期</th>
                    <th>使用者</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <span className={`${styles.badge} ${STATUS[inv.status].cls}`}>
                          {STATUS[inv.status].label}
                        </span>
                      </td>
                      <td>{[inv.note, inv.email].filter(Boolean).join(" · ") || "—"}</td>
                      <td>{fmt(inv.createdAt)}</td>
                      <td>{fmt(inv.expiresAt)}</td>
                      <td>{inv.usedByEmail ?? "—"}</td>
                      <td>
                        {inv.status === "pending" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={revoke.isPending}
                            onClick={() => revoke.mutate(inv.id)}
                          >
                            撤销
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ResetUserPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const reset = useMutation({
    mutationFn: (value: string) =>
      api.post<{ temporaryPassword: string }>("/api/v1/admin/users/reset-password", { email: value }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = emailError(email);
    setError(found);
    if (!found) reset.mutate(email.trim());
  };

  return (
    <form className={`${styles.section} ${styles.form}`} onSubmit={submit} noValidate>
      <h2 className={styles.sectionTitle}>重置用户密码</h2>
      <p className={styles.lead}>
        没有邮件功能时的兜底：为这个账号生成一个临时密码，并让它的所有登录状态失效。操作会记审计日志。
      </p>
      <Field label="用户邮箱" error={error}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <FormError error={reset.error} />
      {reset.isSuccess && (
        <p className={`${styles.notice} ${styles.success}`}>
          临时密码（只显示这一次，请私下告知用户并让 TA 登录后立刻修改）：
          <code> {reset.data.temporaryPassword}</code>
        </p>
      )}
      <div className={styles.actions}>
        <Button type="submit" variant="dark" disabled={reset.isPending}>
          {reset.isPending ? "重置中…" : "重置密码"}
        </Button>
      </div>
    </form>
  );
}
