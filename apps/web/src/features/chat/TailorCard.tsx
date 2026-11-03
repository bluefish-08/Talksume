import { Link } from "react-router";
import { tailorPath } from "../tailor/queries.ts";
import styles from "./JobCards.module.css";
import type { TailorCard } from "./types.ts";

/** 卡片只是草稿入口，采用要用户在定制页逐条确认。 */
export function TailorCardView({ card }: { card: TailorCard }) {
  return (
    <section className={styles.card} aria-label="定制简历">
      <div className={styles.body}>
        <span className={styles.title}>定制版简历草稿 · {card.company}</span>
        <span className={styles.meta}>
          {card.title} · {card.changes} 处调整{card.rejected > 0 ? `，${card.rejected} 处因无出处被拦下` : ""}
        </span>
      </div>
      <p className={styles.reason}>还没生效：确认采用后，投递这个岗位时才会默认用它，主简历不变。</p>
      <div className={styles.actions}>
        <Link className={`${styles.btn} ${styles.primary}`} to={tailorPath(card.jobId)}>
          查看并确认
        </Link>
      </div>
    </section>
  );
}
