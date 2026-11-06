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

/** 卡片只负责看详情；投递按钮在详情页里，按岗位来源说明是站内投递还是去官网。 */
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
            {job.matchKeywords && (
              <ul className={styles.keywords} aria-label="关键词匹配">
                {job.matchKeywords.have.map((k) => (
                  <li key={`h-${k}`} className={styles.kw} data-status="have">
                    <span className="sr-only">已有：</span>
                    {k}
                  </li>
                ))}
                {job.matchKeywords.missing.map((k) => (
                  <li key={`m-${k}`} className={styles.kw} data-status="missing">
                    <span className="sr-only">缺少：</span>
                    {k}
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.actions}>
              <Link className={`${styles.btn} ${styles.primary}`} to={href}>
                看详情
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
