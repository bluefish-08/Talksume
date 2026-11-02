import { Plus } from "lucide-react";
import { Button, Spinner } from "../../components/ui.tsx";
import { cityText, JOB_TYPE_LABELS } from "../applications/format.ts";
import styles from "./HrJobsPane.module.css";
import type { HrJob } from "./types.ts";

interface Props {
  jobs: HrJob[] | undefined;
  loading: boolean;
  failed: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function HrJobsPane({ jobs, loading, failed, selectedId, onSelect, onCreate }: Props) {
  return (
    <section className={styles.pane} aria-labelledby="hr-jobs-h">
      <header className={styles.head}>
        <h2 id="hr-jobs-h" className={styles.title}>
          我的岗位
        </h2>
        <Button size="sm" variant="dark" onClick={onCreate}>
          <Plus size={15} strokeWidth={2} aria-hidden="true" />
          发布岗位
        </Button>
      </header>
      {loading && (
        <div className={styles.center}>
          <Spinner />
        </div>
      )}
      {failed && <p className={styles.note}>岗位加载失败，请刷新重试。</p>}
      {jobs?.length === 0 && (
        <p className={styles.note}>还没有发布过岗位。发布后，候选人在职位推荐里就能看到并投递。</p>
      )}
      {jobs && jobs.length > 0 && (
        <ul className={styles.list}>
          {jobs.map((job) => {
            const fresh = job.byStatus.applied ?? 0;
            const meta = [cityText(job.cities), job.jobType ? JOB_TYPE_LABELS[job.jobType] : ""]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={job.id}>
                <button
                  type="button"
                  className={[styles.item, job.id === selectedId && styles.active].filter(Boolean).join(" ")}
                  aria-pressed={job.id === selectedId}
                  onClick={() => onSelect(job.id)}
                >
                  <span className={styles.name}>{job.title}</span>
                  {meta && <span className={styles.meta}>{meta}</span>}
                  <span className={styles.count}>
                    {job.applicationCount} 份投递
                    {fresh > 0 && <span className={styles.fresh}> · {fresh} 份未查看</span>}
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
