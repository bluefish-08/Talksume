import { statusLabel } from "@talksume/core";
import { dateTime } from "./format.ts";
import styles from "./Timeline.module.css";
import type { ApplicationEvent } from "./types.ts";

const SOURCE: Record<ApplicationEvent["source"], string> = {
  user: "你",
  hr: "HR",
  platform: "平台",
  system: "系统",
};

function eventLabel(e: ApplicationEvent, channel?: string): string {
  if (e.fromStatus === null && e.toStatus === "pending") {
    return channel === "assisted" ? "已记录，待在官网投递" : "创建投递";
  }
  if (e.toStatus === "applied" && channel === "assisted") return "已在官网投递";
  return statusLabel(e.toStatus, e.outcome);
}

export function Timeline({
  events,
  viewer = "candidate",
  channel,
}: {
  events: ApplicationEvent[];
  viewer?: "candidate" | "hr";
  channel?: string;
}) {
  const names = viewer === "hr" ? { ...SOURCE, user: "候选人", hr: "你" } : SOURCE;
  const newestFirst = [...events].reverse();
  return (
    <ol className={styles.list} aria-label="状态时间线">
      {newestFirst.map((e, i) => (
        <li key={e.id} className={[styles.item, i === 0 && styles.latest].filter(Boolean).join(" ")}>
          <span className={styles.dot} aria-hidden="true" />
          <div className={styles.row}>
            <span className={styles.label}>{eventLabel(e, channel)}</span>
            <span className={styles.meta}>
              {names[e.source]} · <time dateTime={e.createdAt}>{dateTime(e.createdAt)}</time>
            </span>
          </div>
          {e.interviewAt && <p className={styles.note}>面试时间：{dateTime(e.interviewAt)}</p>}
          {e.note && <p className={styles.note}>{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}
