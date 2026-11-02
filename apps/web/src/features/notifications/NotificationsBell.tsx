import { Bell } from "lucide-react";
import { useNotifications } from "../../api/queries.ts";
import { IconButton } from "../../components/ui.tsx";

export function NotificationsBell() {
  const unread = useNotifications().data?.unreadCount ?? 0;
  return (
    <IconButton label={unread > 0 ? `通知，${unread} 条未读` : "通知"}>
      <Bell size={17} strokeWidth={1.6} aria-hidden="true" />
      {unread > 0 && <span className="sr-only">{unread}</span>}
    </IconButton>
  );
}
