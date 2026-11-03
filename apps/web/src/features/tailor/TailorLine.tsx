import { Link } from "react-router";
import { tailorPath, useTailoring } from "./queries.ts";
import styles from "./TailorLine.module.css";

/** 告诉用户投递这个岗位会用哪份简历；已投递时显示当时用的是哪份。 */
export function TailorLine({
  jobId,
  appliedTailored,
}: {
  jobId: string;
  appliedTailored?: boolean | undefined;
}) {
  const { data } = useTailoring(jobId);
  const href = tailorPath(jobId);
  if (appliedTailored !== undefined) {
    return <p className={styles.line}>已用{appliedTailored ? "针对这个岗位的定制版" : "通用简历"}投递</p>;
  }
  const tailoring = data?.tailoring;
  if (tailoring?.adopted) {
    return (
      <p className={styles.line} data-tone="ok">
        投递时使用：针对这个岗位的定制版
        <Link className={styles.link} to={href}>
          查看
        </Link>
      </p>
    );
  }
  return (
    <p className={styles.line}>
      投递时使用：通用简历
      <Link className={styles.link} to={href}>
        {tailoring ? "定制版待确认" : "定制简历"}
      </Link>
    </p>
  );
}
