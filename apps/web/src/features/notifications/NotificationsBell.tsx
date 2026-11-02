import { useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { qk, useNotifications } from "../../api/queries.ts";
import { subscribeSse } from "../../api/sse.ts";
import type { NotificationItem } from "../../api/types.ts";
import { useToast } from "../../components/Toast.tsx";
import { IconButton } from "../../components/ui.tsx";
import styles from "./NotificationsBell.module.css";
import { NotificationsPanel } from "./NotificationsPanel.tsx";

type Pushed = Pick<NotificationItem, "title" | "refId">;

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const unread = useNotifications().data?.unreadCount ?? 0;
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const onPush = useRef<(n: Pushed) => void>(() => {});
  onPush.current = (n) => {
    void client.invalidateQueries({ queryKey: qk.notifications });
    void client.invalidateQueries({ queryKey: qk.applications });
    toast(n.title, {
      ms: 6000,
      action: { label: "查看", onClick: () => navigate(`/applications?app=${n.refId}`) },
    });
  };

  useEffect(() => {
    let connected = false;
    return subscribeSse("/api/v1/notifications/stream", {
      notification: (data) => onPush.current(data as Pushed),
      // 流不重放：断线重连后补拉一次，首次连接已有初始查询
      open: () => {
        if (connected) void client.invalidateQueries({ queryKey: qk.notifications });
        connected = true;
      },
    });
  }, [client]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <span ref={wrap} className={styles.wrap}>
        <IconButton
          label={unread > 0 ? `通知，${unread} 条未读` : "通知"}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Bell size={17} strokeWidth={1.6} aria-hidden="true" />
        </IconButton>
        {unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </span>
      {open && <NotificationsPanel anchor={wrap} onClose={close} />}
    </>
  );
}
