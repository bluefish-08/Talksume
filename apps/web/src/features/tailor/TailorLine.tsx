import { Link } from "react-router";
import { tailorEntry } from "./entry.ts";
import { tailoringHref } from "./links.ts";
import type { TailoringView } from "./queries.ts";
import styles from "./TailorLine.module.css";

/** 告诉用户投递这个岗位会用哪份简历，已采用时给出回到对话的入口。 */
export function TailorLine({ jobId, view }: { jobId: string; view: TailoringView | undefined }) {
  const entry = tailorEntry(view);
  if (entry.adopted) {
    return (
      <p className={styles.line} data-tone="ok">
        <span>投递时用：</span>
        <strong>{entry.company}定制版</strong>
        <span className={styles.badge}>已采用</span>
        <Link className={styles.link} to={tailoringHref(entry, jobId)}>
          在对话里看
        </Link>
      </p>
    );
  }
  return (
    <p className={styles.line}>
      <span>投递时用：</span>
      <strong>主简历</strong>
      <span className={styles.note}>· 还没有这个岗位的定制版</span>
    </p>
  );
}
