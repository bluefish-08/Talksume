import { type ApplicationStatus, statusLabel } from "@talksume/core";
import { Link } from "react-router";
import styles from "./BoardColumn.module.css";
import { cityText, dateTime, relativeTime } from "./format.ts";
import { ChannelTag, StatusTag } from "./Tags.tsx";
import type { BoardItem } from "./types.ts";

export function BoardColumn({
  status,
  items,
  activeId,
}: {
  status: ApplicationStatus;
  items: BoardItem[];
  activeId: string | null;
}) {
  const heading = `col-${status}`;
  return (
    <section className={styles.column} aria-labelledby={heading}>
      <h2 id={heading} className={styles.heading}>
        {statusLabel(status)}
        <span className={styles.count}>{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className={styles.none}>暂无</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <Card item={item} active={item.id === activeId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Card({ item, active }: { item: BoardItem; active: boolean }) {
  const place = [item.job.company, cityText(item.job.cities)].filter(Boolean).join(" · ");
  const interviewAt = item.status === "interviewing" ? item.lastEvent?.interviewAt : null;
  return (
    <Link
      to={`?app=${item.id}`}
      className={[styles.card, active && styles.active].filter(Boolean).join(" ")}
      aria-label={`${item.job.title}，${place}`}
    >
      <span className={styles.cardTitle} title={item.job.title}>
        {item.job.title}
      </span>
      <span className={styles.place} title={place}>
        {place}
      </span>
      {interviewAt && <span className={styles.interview}>面试 {dateTime(interviewAt)}</span>}
      {item.channel === "assisted" && item.status === "pending" && (
        <span className={styles.interview}>已记录，记得在官网完成投递</span>
      )}
      <span className={styles.foot}>
        <span className={styles.tags}>
          <ChannelTag channel={item.channel} />
          {item.status === "closed" && <StatusTag status="closed" outcome={item.outcome} />}
        </span>
        <time className={styles.time} dateTime={item.updatedAt}>
          {relativeTime(item.updatedAt)}
        </time>
      </span>
    </Link>
  );
}
