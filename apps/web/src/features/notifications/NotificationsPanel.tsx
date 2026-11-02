import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Clock, Repeat } from "lucide-react";
import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { api } from "../../api/client.ts";
import { qk, useNotifications } from "../../api/queries.ts";
import type { NotificationItem } from "../../api/types.ts";
import { Button, Spinner } from "../../components/ui.tsx";
import { relativeTime } from "../applications/format.ts";
import { useDialogBehavior } from "../applications/useDialogBehavior.ts";
import styles from "./NotificationsPanel.module.css";

const KIND_ICON = { status_changed: Repeat, follow_up: Clock, interview_soon: CalendarClock } as const;

const WIDTH = 368;
const GAP = 12;

/** 锚点在侧栏底部：桌面端贴着侧栏右侧向上展开，窄屏则落在按钮上方。 */
function place(anchor: HTMLElement): CSSProperties {
  const r = anchor.getBoundingClientRect();
  const width = Math.min(WIDTH, window.innerWidth - 16);
  const beside = r.right + GAP + width <= window.innerWidth - 8;
  if (beside) {
    const bottom = Math.max(window.innerHeight - r.bottom, 8);
    return { left: r.right + GAP, bottom, width, maxHeight: Math.min(520, window.innerHeight - bottom - 8) };
  }
  const bottom = window.innerHeight - r.top + 8;
  return {
    left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
    bottom,
    width,
    maxHeight: Math.min(520, window.innerHeight - bottom - 8),
  };
}

export function NotificationsPanel({
  anchor,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>();
  const list = useNotifications();
  const client = useQueryClient();
  const navigate = useNavigate();

  useDialogBehavior(panel, onClose, {
    returnFocus: () => anchor.current?.querySelector("button"),
  });

  useLayoutEffect(() => {
    const el = anchor.current;
    if (!el) return;
    const update = () => setStyle(place(el));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [anchor, onClose]);

  const markRead = useMutation({
    mutationFn: (ids?: string[]) =>
      api.post<{ updated: number; unreadCount: number }>("/api/v1/notifications/read", ids ? { ids } : {}),
    onSettled: () => client.invalidateQueries({ queryKey: qk.notifications }),
  });

  const open = (n: NotificationItem) => {
    if (!n.readAt) markRead.mutate([n.id]);
    onClose();
    navigate(`/applications?app=${n.refId}`);
  };

  const items = list.data?.items ?? [];
  const unread = list.data?.unreadCount ?? 0;

  return createPortal(
    <div ref={panel} className={styles.panel} style={style} role="dialog" aria-label="通知" tabIndex={-1}>
      <header className={styles.head}>
        <h2 className={styles.title}>通知</h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={unread === 0 || markRead.isPending}
          onClick={() => markRead.mutate(undefined)}
        >
          全部已读
        </Button>
      </header>
      <div className={styles.scroll}>
        {list.isPending && (
          <div className={styles.center}>
            <Spinner />
          </div>
        )}
        {list.isError && <p className={styles.empty}>通知加载失败，请稍后再试。</p>}
        {list.data && items.length === 0 && <p className={styles.empty}>暂时没有通知。</p>}
        {items.length > 0 && (
          <ul className={styles.list}>
            {items.map((n) => {
              const Icon = KIND_ICON[n.kind];
              return (
                <li key={n.id}>
                  <button type="button" className={styles.item} onClick={() => open(n)}>
                    <span className={styles.icon} aria-hidden="true">
                      <Icon size={16} strokeWidth={1.6} />
                    </span>
                    <span className={styles.text}>
                      <span className={n.readAt ? styles.read : styles.unread}>{n.title}</span>
                      <span className={styles.time}>
                        {n.readAt ? "" : <span className="sr-only">未读，</span>}
                        {relativeTime(n.createdAt)}
                      </span>
                    </span>
                    {!n.readAt && <span className={styles.dot} aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
