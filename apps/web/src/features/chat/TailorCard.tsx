import styles from "./JobCards.module.css";
import type { TailorCard } from "./types.ts";

/** 卡片只是草稿入口，采用要用户在简历面板里确认。 */
export function TailorCardView({ card, onOpen }: { card: TailorCard; onOpen: (card: TailorCard) => void }) {
  return (
    <section className={styles.card} aria-label="定制简历">
      <div className={styles.body}>
        <span className={styles.title}>定制版简历草稿 · {card.company}</span>
        <span className={styles.meta}>
          {card.title} · {card.changes} 处调整{card.rejected > 0 ? `，${card.rejected} 处因无出处被拦下` : ""}
        </span>
      </div>
      <p className={styles.reason}>
        还没生效：在简历里看过改动、点「采用」后，投递这个岗位时才默认用它，主简历不变。
      </p>
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => onOpen(card)}>
          在简历里查看
        </button>
      </div>
    </section>
  );
}
