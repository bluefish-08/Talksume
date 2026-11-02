import { type KeyboardEvent, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import styles from "./Browse.module.css";

export type JobsTab = "recommend" | "all";

const TABS: { key: JobsTab; label: string; search: string }[] = [
  { key: "recommend", label: "为你推荐", search: "" },
  { key: "all", label: "全部岗位", search: "?tab=all" },
];

// 两个 tab 是不同页面组件，切换会重新挂载；键盘切换后要把焦点带到新选中项上。
let restoreFocus = false;

export function JobsTabs({
  current,
  counts,
}: {
  current: JobsTab;
  counts?: Partial<Record<JobsTab, number>>;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const refs = useRef<Record<JobsTab, HTMLButtonElement | null>>({ recommend: null, all: null });

  useEffect(() => {
    if (!restoreFocus) return;
    restoreFocus = false;
    refs.current[current]?.focus();
  }, [current]);

  function go(key: JobsTab) {
    const tab = TABS.find((t) => t.key === key);
    if (tab && key !== current) navigate(`${pathname}${tab.search}`);
  }

  function onKeyDown(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.key === current);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    restoreFocus = true;
    go(TABS[next]?.key ?? current);
  }

  return (
    <>
      <h1 className={styles.title}>职位</h1>
      <div className={styles.tabs} role="tablist" aria-label="职位视图" onKeyDown={onKeyDown}>
        {TABS.map((t) => {
          const selected = t.key === current;
          const count = counts?.[t.key];
          return (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[t.key] = el;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={styles.tab}
              onClick={() => go(t.key)}
            >
              {t.label}
              {count !== undefined && <span className={styles.badge}>{count.toLocaleString()}</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}
