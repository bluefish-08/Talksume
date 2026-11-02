import { jobMeta, reasonLine } from "./format.ts";
import styles from "./JobList.module.css";
import type { JobSummary, MatchItem } from "./types.ts";

export interface JobRow {
  job: JobSummary;
  match?: MatchItem | undefined;
}

export function JobList({
  rows,
  selectedId,
  onSelect,
  label,
}: {
  rows: JobRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  label: string;
}) {
  return (
    <ol className={styles.list} aria-label={label}>
      {rows.map(({ job, match }) => {
        const selected = job.id === selectedId;
        const reason = match ? reasonLine(match) : undefined;
        return (
          <li key={job.id}>
            <button
              type="button"
              className={styles.row}
              data-selected={selected || undefined}
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(job.id)}
            >
              <span className={styles.body}>
                <span className={styles.title}>{job.title}</span>
                <span className={styles.meta}>{jobMeta(job)}</span>
                {reason ? (
                  <span className={styles.reason}>{reason}</span>
                ) : (
                  !match && job.snippet && <span className={styles.reason}>{job.snippet}</span>
                )}
              </span>
              {match && (
                <span className={styles.score}>
                  <span className={styles.scoreNum}>{Math.round(match.score)}</span>
                  <span className={styles.scoreLabel}>匹配度</span>
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function JobListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ol className={styles.list} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 静态占位
        <li key={i} className={styles.skeleton}>
          <span className={styles.skLine} style={{ width: "55%", height: 16 }} />
          <span className={styles.skLine} style={{ width: "70%" }} />
          <span className={styles.skLine} style={{ width: "85%" }} />
        </li>
      ))}
    </ol>
  );
}
