import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, api } from "../../api/client.ts";
import { Button } from "../../components/ui.tsx";
import { Field } from "./Field.tsx";
import styles from "./HrSetup.module.css";
import type { HrIdentity } from "./identity.tsx";

export function HrSetup({ onDone }: { onDone: (identity: HrIdentity) => void }) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [errors, setErrors] = useState<{ name?: string; company?: string }>({});

  const create = useMutation({
    mutationFn: (displayName: string) =>
      api.post<{ userId: string; displayName: string }>("/api/v1/dev/hr", {
        displayName,
        email: `hr-${crypto.randomUUID().slice(0, 8)}@talksume.local`,
      }),
    onSuccess: (res) => onDone({ userId: res.userId, displayName: res.displayName, company: company.trim() }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = {
      name: name.trim() ? undefined : "请填写你的名字",
      company: company.trim() ? undefined : "请填写公司名称",
    };
    setErrors(next);
    if (!next.name && !next.company) create.mutate(name.trim());
  };

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={submit} noValidate>
        <h1 className={styles.title}>创建 HR 身份</h1>
        <p className={styles.lead}>
          登录功能上线前，先用一个演示身份发布岗位、处理候选人的投递。身份只保存在这个浏览器里。
        </p>
        <Field label="你的名字" required error={errors.name}>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="公司" required error={errors.company} hint="发布岗位时默认使用">
          <input value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" />
        </Field>
        {create.isError && (
          <p className={styles.error} role="alert">
            {create.error instanceof ApiError && create.error.status === 404
              ? "当前服务端没有开启演示 HR 接口（仅非生产环境可用）。"
              : create.error.message}
          </p>
        )}
        <Button type="submit" variant="dark" size="lg" disabled={create.isPending}>
          {create.isPending ? "创建中…" : "进入 HR 工作台"}
        </Button>
      </form>
    </div>
  );
}
