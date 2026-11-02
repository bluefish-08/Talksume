import { APPLICATION_STATUSES, type ApplicationStatus, statusLabel } from "@talksume/core";
import { Link, useSearchParams } from "react-router";
import { Button, EmptyState, Spinner } from "../components/ui.tsx";
import { ApplicationDrawer } from "../features/applications/ApplicationDrawer.tsx";
import { BoardColumn } from "../features/applications/BoardColumn.tsx";
import { useBoard } from "../features/applications/queries.ts";
import styles from "./Applications.module.css";

function summary(counts: Record<ApplicationStatus, number>, total: number): string {
  const parts = APPLICATION_STATUSES.filter((s) => counts[s] > 0).map(
    (s) => `${statusLabel(s)} ${counts[s]}`,
  );
  return `共 ${total} 个投递 · ${parts.join(" · ")}`;
}

export function ApplicationsPage() {
  const board = useBoard();
  const [params, setParams] = useSearchParams();
  const openId = params.get("app");

  const closeDrawer = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("app");
        return next;
      },
      { replace: true },
    );

  const data = board.data;
  const counts = Object.fromEntries(
    APPLICATION_STATUSES.map((s) => [s, data?.columns[s].length ?? 0]),
  ) as Record<ApplicationStatus, number>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>投递进度</h1>
        {data && data.total > 0 && <p className={styles.sub}>{summary(counts, data.total)}</p>}
      </header>

      {board.isPending && (
        <div className={styles.center}>
          <Spinner />
        </div>
      )}

      {board.isError && (
        <EmptyState title="投递进度加载失败">
          <Button onClick={() => void board.refetch()}>重试</Button>
        </EmptyState>
      )}

      {data && data.total === 0 && (
        <EmptyState title="还没有投递记录">
          <p className={styles.emptyText}>在职位推荐里挑几个合适的岗位，投递后进度会出现在这里。</p>
          <Link to="/jobs" className={styles.emptyLink}>
            去看职位推荐
          </Link>
        </EmptyState>
      )}

      {data && data.total > 0 && (
        <div className={styles.scroller}>
          <div className={styles.board}>
            {APPLICATION_STATUSES.map((s) => (
              <BoardColumn key={s} status={s} items={data.columns[s]} activeId={openId} />
            ))}
          </div>
        </div>
      )}

      {openId && <ApplicationDrawer key={openId} id={openId} onClose={closeDrawer} />}
    </div>
  );
}
