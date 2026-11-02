import type { Completeness } from "../../api/types.ts";
import { ProgressBar } from "../../components/ui.tsx";
import styles from "./CompletenessBar.module.css";
import { missingText } from "./resumeUtils.ts";

export function CompletenessBar({ completeness }: { completeness: Completeness | undefined }) {
  const score = completeness?.score ?? 0;
  const missing = missingText(completeness);
  return (
    <div className={styles.bar}>
      <span className={styles.label}>完整度</span>
      <div className={styles.track}>
        <ProgressBar value={score} label="简历完整度" />
      </div>
      <span className={styles.pct}>{Math.round(score * 100)}%</span>
      {missing && <span className={styles.missing}>{missing}</span>}
    </div>
  );
}
