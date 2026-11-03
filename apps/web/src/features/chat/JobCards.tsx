import { Link } from "react-router";
import { citiesText, jobTypeLabel } from "../jobs/format.ts";
import styles from "./JobCards.module.css";
import type { JobCard } from "./types.ts";

const detailHref = (id: string) => `/jobs?job=${encodeURIComponent(id)}`;

export function JobAbout({ job }: { job: JobCard }) {
  return (
    <Link className={styles.about} to={detailHref(job.id)} title="查看岗位详情">
      <span className={styles.aboutLabel}>关于</span>
      <span className={styles.aboutText}>
        {job.company} · {job.title}
        {job.score !== undefined && ` · 匹配 ${Math.round(job.score)}`}
      </span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}

/** 投递只跳到职位页，由用户在那里亲手确认。 */
export function JobCards({ jobs }: { jobs: JobCard[] }) {
  return (
    <ul className={styles.list} aria-label="岗位">
      {jobs.map((job) => {
        const href = detailHref(job.id);
        const meta = [job.company, citiesText(job.cities), jobTypeLabel(job.jobType)]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={job.id} className={styles.card}>
            <div className={styles.head}>
              <div className={styles.body}>
                <span className={styles.title}>{job.title}</span>
                <span className={styles.meta}>{meta}</span>
              </div>
              {job.score !== undefined && (
                <span className={styles.score}>
                  <span className={styles.scoreNum}>{Math.round(job.score)}</span>
                  <span className={styles.scoreLabel}>匹配度</span>
                </span>
              )}
            </div>
            {job.reason && <p className={styles.reason}>{job.reason}</p>}
            <div className={styles.actions}>
              <Link className={styles.btn} to={href}>
                看详情
              </Link>
              <Link className={`${styles.btn} ${styles.primary}`} to={href}>
                去投递
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
