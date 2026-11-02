import { useState } from "react";
import { ApiError } from "../../api/client.ts";
import { useToast } from "../../components/Toast.tsx";
import { Button, Spinner } from "../../components/ui.tsx";
import { Modal } from "../applications/Modal.tsx";
import { StatusTag } from "../applications/Tags.tsx";
import { Timeline } from "../applications/Timeline.tsx";
import { Field } from "./Field.tsx";
import styles from "./HrApplicationDrawer.module.css";
import { HrResumeView } from "./HrResumeView.tsx";
import { useHrApplicationDetail, useSetStatus } from "./queries.ts";
import type { HrApplicationDetail, StatusInput } from "./types.ts";

type Decision = "schedule" | "offer" | "reject";

const DECISIONS: Record<Decision, { confirm: string; done: string }> = {
  schedule: { confirm: "确认安排", done: "已安排面试，候选人会收到通知" },
  offer: { confirm: "确认发 offer", done: "已发 offer，候选人会收到通知" },
  reject: { confirm: "确认不合适", done: "已标记为不合适，候选人会收到通知" },
};

export function HrApplicationDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useHrApplicationDetail(id);
  const detail = query.data;
  return (
    <Modal
      variant="drawer"
      wide
      title={detail ? detail.candidate.displayName : "投递详情"}
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
          {query.error instanceof ApiError && query.error.status === 403
            ? "只能查看自己发布职位收到的投递。"
            : "加载失败，请稍后再试。"}
        </p>
      )}
      {detail && <Body detail={detail} />}
    </Modal>
  );
}

function Body({ detail }: { detail: HrApplicationDetail }) {
  const { application: app, candidate, job, resume, timeline } = detail;
  return (
    <div className={styles.body}>
      <section className={styles.summary}>
        <p className={styles.line}>
          投递 <strong>{job.title}</strong>
        </p>
        <p className={styles.meta}>{candidate.email}</p>
        <div className={styles.tags}>
          <StatusTag status={app.status} outcome={app.outcome} />
        </div>
        {app.pitch && <p className={styles.pitch}>{app.pitch}</p>}
      </section>

      <section className={styles.section}>
        <h3 className={styles.h}>简历</h3>
        {resume ? (
          <HrResumeView content={resume.content} />
        ) : (
          <p className={styles.muted}>候选人投递时没有附带简历。</p>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.h}>进度记录</h3>
        <Timeline events={timeline} viewer="hr" />
      </section>
    </div>
  );
}

function Actions({ detail }: { detail: HrApplicationDetail }) {
  const { application: app } = detail;
  const toast = useToast();
  const run = useSetStatus(app.id);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [interviewAt, setInterviewAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (app.status === "closed" || app.status === "pending") {
    return (
      <span className={styles.hint}>
        {app.status === "closed" ? "这条投递已结束。" : "候选人还没有完成投递。"}
      </span>
    );
  }

  const canInterview = app.status === "viewed";
  const canOffer = app.status === "interviewing";

  if (decision === null) {
    return (
      <>
        <Button onClick={() => setDecision("reject")}>不合适</Button>
        {canInterview && (
          <Button variant="dark" onClick={() => setDecision("schedule")}>
            安排面试
          </Button>
        )}
        {canOffer && (
          <Button variant="dark" onClick={() => setDecision("offer")}>
            发 offer
          </Button>
        )}
        {!canInterview && !canOffer && (
          <span className={styles.hint}>候选人刚投递，打开详情后会自动标为已查看。</span>
        )}
      </>
    );
  }

  const submit = () => {
    const trimmed = note.trim();
    const input: StatusInput =
      decision === "schedule"
        ? { to: "interviewing" }
        : { to: "closed", outcome: decision === "offer" ? "offer" : "rejected" };
    if (trimmed) input.note = trimmed;
    if (decision === "schedule") {
      const at = new Date(interviewAt);
      if (!interviewAt || Number.isNaN(at.getTime())) return setError("请选择面试时间");
      if (at.getTime() < Date.now()) return setError("面试时间不能早于现在");
      input.interviewAt = at.toISOString();
    }
    setError(null);
    run.mutate(input, {
      onSuccess: () => toast(DECISIONS[decision].done, { tone: "success" }),
      onError: (err) => setError(err.message),
    });
  };

  return (
    <div className={styles.confirm}>
      {decision === "schedule" && (
        <Field label="面试时间" required>
          <input type="datetime-local" value={interviewAt} onChange={(e) => setInterviewAt(e.target.value)} />
        </Field>
      )}
      <Field label="给候选人的留言" hint="选填，会出现在候选人的进度记录里">
        <textarea
          rows={2}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder={decision === "schedule" ? "如：面试地点或会议链接" : ""}
        />
      </Field>
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.confirmActions}>
        <Button onClick={() => setDecision(null)}>返回</Button>
        <Button variant="dark" disabled={run.isPending} onClick={submit}>
          {DECISIONS[decision].confirm}
        </Button>
      </div>
    </div>
  );
}
