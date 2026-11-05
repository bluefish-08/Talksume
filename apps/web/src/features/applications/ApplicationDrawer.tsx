import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../api/client.ts";
import { useToast } from "../../components/Toast.tsx";
import { Button, Spinner } from "../../components/ui.tsx";
import styles from "./ApplicationDrawer.module.css";
import { cityText, JOB_TYPE_LABELS } from "./format.ts";
import { Modal } from "./Modal.tsx";
import { type ApplicationAction, useApplicationAction, useApplicationDetail } from "./queries.ts";
import { ChannelTag, ResumeTag, StatusTag } from "./Tags.tsx";
import { Timeline } from "./Timeline.tsx";
import type { Application, ApplicationDetail } from "./types.ts";

interface Backfill {
  label: string;
  action: ApplicationAction;
}

function backfillOptions(status: Application["status"]): Backfill[] {
  const reject: Backfill = { label: "未通过", action: { kind: "status", to: "closed", outcome: "rejected" } };
  if (status === "applied")
    return [{ label: "对方已查看", action: { kind: "status", to: "viewed" } }, reject];
  if (status === "viewed")
    return [{ label: "进入面试", action: { kind: "status", to: "interviewing" } }, reject];
  if (status === "interviewing")
    return [{ label: "拿到 offer", action: { kind: "status", to: "closed", outcome: "offer" } }, reject];
  return [];
}

export function ApplicationDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useApplicationDetail(id);
  const detail = query.data;
  return (
    <Modal
      variant="drawer"
      title={detail ? detail.job.title : "投递详情"}
      onClose={onClose}
      footer={detail && <Actions key={detail.application.status} detail={detail} />}
    >
      {query.isPending && (
        <div className={styles.center}>
          <Spinner />
        </div>
      )}
      {query.isError && (
        <p className={styles.error} role="alert">
          {query.error instanceof ApiError && query.error.status === 404
            ? "找不到这条投递，可能已被删除。"
            : "加载失败，请稍后再试。"}
        </p>
      )}
      {detail && <Body detail={detail} />}
    </Modal>
  );
}

function Body({ detail }: { detail: ApplicationDetail }) {
  const { application: app, job, timeline } = detail;
  const meta = [cityText(job.cities), job.jobType ? JOB_TYPE_LABELS[job.jobType] : ""].filter(Boolean);
  return (
    <div className={styles.body}>
      <section className={styles.section}>
        <p className={styles.company}>{job.company}</p>
        {meta.length > 0 && <p className={styles.meta}>{meta.join(" · ")}</p>}
        <div className={styles.tags}>
          <StatusTag status={app.status} outcome={app.outcome} />
          <ChannelTag channel={app.channel} />
          {app.resumeVersionId && <ResumeTag tailored={!!app.resumeTailored} />}
        </div>
        {app.channel === "assisted" && app.status === "pending" && (
          <p className={styles.pending}>
            已记录，但还没有投出去：记得在官网完成投递，再回来点「我已在官网投递」。
          </p>
        )}
        {job.url && (
          <a className={styles.link} href={job.url} target="_blank" rel="noreferrer">
            查看职位原文
            <ExternalLink size={14} strokeWidth={1.6} aria-hidden="true" />
          </a>
        )}
      </section>

      {app.pitch && (
        <section className={styles.section}>
          <h3 className={styles.h}>投递留言</h3>
          <p className={styles.pitch}>{app.pitch}</p>
        </section>
      )}

      <section className={styles.section}>
        <h3 className={styles.h}>进度记录</h3>
        <Timeline events={timeline} channel={app.channel} />
      </section>
    </div>
  );
}

function Actions({ detail }: { detail: ApplicationDetail }) {
  const { application: app, job } = detail;
  const toast = useToast();
  const run = useApplicationAction(app.id);
  const [confirming, setConfirming] = useState(false);

  if (app.status === "closed") return <span className={styles.hint}>这条投递已结束。</span>;

  const submit = (action: ApplicationAction) =>
    run.mutate(action, {
      onError: (err) => toast(err.message, { tone: "error" }),
    });

  if (confirming) {
    return (
      <>
        <span className={styles.confirm}>确定撤回这次投递吗？撤回后不能恢复。</span>
        <Button size="sm" onClick={() => setConfirming(false)}>
          再想想
        </Button>
        <Button
          size="sm"
          variant="dark"
          disabled={run.isPending}
          onClick={() => submit({ kind: "withdraw" })}
        >
          确认撤回
        </Button>
      </>
    );
  }

  const assisted = app.channel === "assisted";
  return (
    <>
      {!assisted && <span className={styles.hint}>状态由招聘方更新，有变化会通知你。</span>}
      <Button size="sm" variant="ghost" className={styles.withdraw} onClick={() => setConfirming(true)}>
        撤回
      </Button>
      {assisted &&
        app.status === "pending" &&
        (job.url ? (
          <a className={styles.officialLink} href={job.url} target="_blank" rel="noreferrer">
            去官网投递
            <ExternalLink size={14} strokeWidth={1.6} aria-hidden="true" />
          </a>
        ) : null)}
      {assisted && app.status === "pending" && (
        <Button
          size="sm"
          variant="primary"
          disabled={run.isPending}
          onClick={() => submit({ kind: "mark-applied" })}
        >
          我已在官网投递
        </Button>
      )}
      {assisted &&
        backfillOptions(app.status).map((o) => (
          <Button
            key={o.label}
            size="sm"
            variant={o.label === "未通过" ? "secondary" : "primary"}
            disabled={run.isPending}
            onClick={() => submit(o.action)}
          >
            {o.label}
          </Button>
        ))}
    </>
  );
}
