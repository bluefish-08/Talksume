import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui.tsx";
import { Modal } from "../applications/Modal.tsx";
import { Field } from "./Field.tsx";
import { useHr } from "./identity.tsx";
import styles from "./JobFormDialog.module.css";
import { buildJobInput, type JobFormErrors, type JobFormValues } from "./jobForm.ts";
import { useCreateJob } from "./queries.ts";
import type { HrJob } from "./types.ts";

const FORM_ID = "hr-job-form";

export function JobFormDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (job: HrJob) => void;
}) {
  const { identity } = useHr();
  const create = useCreateJob();
  const [values, setValues] = useState<JobFormValues>({
    title: "",
    company: identity.company,
    cities: "",
    jobType: "internship",
    salaryMin: "",
    salaryMax: "",
    degree: "",
    jdText: "",
    tags: "",
    url: "",
  });
  const [errors, setErrors] = useState<JobFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const bind = (name: keyof JobFormValues) => ({
    name,
    value: values[name],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: e.target.value })),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = buildJobInput(values);
    if ("errors" in result) {
      setErrors(result.errors);
      const form = e.currentTarget as HTMLFormElement;
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setErrors({});
    setServerError(null);
    create.mutate(result.input, {
      onSuccess: ({ job }) => onCreated(job),
      onError: (err) => setServerError(err.message),
    });
  };

  return (
    <Modal
      title="发布岗位"
      onClose={onClose}
      footer={
        <>
          {serverError && (
            <span className={styles.serverError} role="alert">
              {serverError}
            </span>
          )}
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" form={FORM_ID} variant="dark" disabled={create.isPending}>
            {create.isPending ? "发布中…" : "发布"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.row}>
          <Field label="岗位名称" required error={errors.title}>
            <input {...bind("title")} placeholder="如：后端开发实习生" autoComplete="off" />
          </Field>
          <Field label="公司" required error={errors.company}>
            <input {...bind("company")} autoComplete="organization" />
          </Field>
        </div>
        <div className={styles.row}>
          <Field label="类型">
            <select {...bind("jobType")}>
              <option value="internship">实习</option>
              <option value="campus">校招</option>
              <option value="experienced">社招</option>
            </select>
          </Field>
          <Field label="学历要求">
            <select {...bind("degree")}>
              <option value="">不填</option>
              <option value="any">不限</option>
              <option value="associate">大专</option>
              <option value="bachelor">本科</option>
              <option value="master">硕士</option>
              <option value="phd">博士</option>
            </select>
          </Field>
        </div>
        <Field label="工作城市" hint="多个城市用逗号分隔">
          <input {...bind("cities")} placeholder="如：上海，杭州" autoComplete="off" />
        </Field>
        <div className={styles.row}>
          <Field label="月薪下限（千元）" error={errors.salaryMin}>
            <input {...bind("salaryMin")} inputMode="decimal" placeholder="如：8" autoComplete="off" />
          </Field>
          <Field label="月薪上限（千元）" error={errors.salaryMax}>
            <input {...bind("salaryMax")} inputMode="decimal" placeholder="如：12" autoComplete="off" />
          </Field>
        </div>
        <Field label="岗位职责与要求" required error={errors.jdText}>
          <textarea {...bind("jdText")} rows={6} />
        </Field>
        <Field label="技能标签" hint="多个标签用逗号分隔，用于和候选人简历匹配">
          <input {...bind("tags")} placeholder="如：Go，MySQL" autoComplete="off" />
        </Field>
        <Field label="职位链接" hint="选填，候选人可以点开查看原文" error={errors.url}>
          <input {...bind("url")} type="url" placeholder="https://" autoComplete="off" />
        </Field>
      </form>
    </Modal>
  );
}
