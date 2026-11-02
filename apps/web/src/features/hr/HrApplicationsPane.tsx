import { APPLICATION_STATUSES, type ApplicationStatus, statusLabel } from "@talksume/core";
import { useState } from "react";
import { Chip, Spinner } from "../../components/ui.tsx";
import { relativeTime } from "../applications/format.ts";
import { StatusTag } from "../applications/Tags.tsx";
import { candidateIdentity } from "./candidate.ts";
import styles from "./HrApplicationsPane.module.css";
import type { HrApplication, HrJob } from "./types.ts";

interface Props {
  job: HrJob | undefined;
  items: HrApplication[] | undefined;
  loading: boolean;
  failed: boolean;
  activeId: string | null;
  onOpen: (id: string) => void;
}

export function HrApplicationsPane({ job, items, loading, failed, activeId, onOpen }: Props) {
  const [filter, setFilter] = useState<ApplicationStatus | "all">("all");
  const shown = (items ?? []).filter((i) => filter === "all" || i.application.status === filter);
  const countOf = (s: ApplicationStatus) => (items ?? []).filter((i) => i.application.status === s).length;

  if (!job) return <p className={styles.note}>选择左侧的岗位，查看收到的投递。</p>;

  return (
    <section className={styles.pane} aria-labelledby="hr-apps-h">
      <header className={styles.head}>
        <div>
          <h2 id="hr-apps-h" className={styles.title}>
            {job.title}
          </h2>
          <p className={styles.sub}>收到的投递</p>
        </div>
      </header>

      <fieldset className={styles.filters}>
        <legend className="sr-only">按状态筛选</legend>
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          全部 {items?.length ?? 0}
        </Chip>
        {APPLICATION_STATUSES.filter((s) => s !== "pending").map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {statusLabel(s)} {countOf(s)}
          </Chip>
        ))}
      </fieldset>

      {loading && (
        <div className={styles.center}>
          <Spinner />
        </div>
      )}
      {failed && <p className={styles.note}>投递加载失败，请稍后再试。</p>}
      {items && shown.length === 0 && (
        <p className={styles.note}>{items.length === 0 ? "还没有收到投递。" : "这个状态下没有投递。"}</p>
      )}
      {shown.length > 0 && (
        <ul className={styles.list}>
          {shown.map((item) => {
            const { application } = item;
            const who = candidateIdentity(item);
            return (
              <li key={application.id}>
                <button
                  type="button"
                  className={[styles.row, application.id === activeId && styles.active]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onOpen(application.id)}
                >
                  <span className={styles.who}>
                    <span className={styles.avatar} aria-hidden="true">
                      {who.name.slice(0, 1)}
                    </span>
                    <span className={styles.names}>
                      <span className={styles.name}>{who.name}</span>
                      <span className={styles.email}>{who.contacts.join(" · ")}</span>
                    </span>
                  </span>
                  <span className={styles.right}>
                    <StatusTag status={application.status} outcome={application.outcome} />
                    <time className={styles.time} dateTime={application.updatedAt}>
                      {relativeTime(application.updatedAt)}
                    </time>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
