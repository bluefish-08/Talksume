import { Link, useLocation } from "react-router";
import styles from "./Browse.module.css";

export type JobsTab = "recommend" | "all";

const TABS: { key: JobsTab; label: string; search: string }[] = [
  { key: "recommend", label: "为你推荐", search: "" },
  { key: "all", label: "全部岗位", search: "?tab=all" },
];

export function JobsTabs({ current }: { current: JobsTab }) {
  const { pathname } = useLocation();
  return (
    <>
      <h1 className="sr-only">{TABS.find((t) => t.key === current)?.label}</h1>
      <nav className={styles.tabs} aria-label="职位视图">
        {TABS.map((t) => (
          <Link
            key={t.key}
            to={`${pathname}${t.search}`}
            className={styles.tab}
            aria-current={t.key === current ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
