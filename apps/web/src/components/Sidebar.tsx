import { FileText, ListChecks, Plus, Search } from "lucide-react";
import { NavLink } from "react-router";
import { useConversations, useProfile, useStartConversation } from "../api/queries.ts";
import { NotificationsBell } from "../features/notifications/NotificationsBell.tsx";
import { Logo } from "./Logo.tsx";
import styles from "./Sidebar.module.css";

const NAV = [
  { to: "/resume", label: "我的简历", icon: FileText },
  { to: "/jobs", label: "职位推荐", icon: Search },
  { to: "/applications", label: "投递进度", icon: ListChecks },
] as const;

const linkClass = ({ isActive }: { isActive: boolean }) =>
  [styles.link, isActive && styles.active].filter(Boolean).join(" ");

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const conversations = useConversations();
  const profile = useProfile();
  const start = useStartConversation();
  const name = profile.data?.profile.basics.name || "我";

  return (
    <nav aria-label="侧边栏" className={styles.sidebar}>
      <div className={styles.brand}>
        <NavLink to="/" onClick={onNavigate} aria-label="简聊首页" className={styles.brandLink}>
          <Logo />
        </NavLink>
      </div>

      <button
        type="button"
        className={styles.newChat}
        disabled={start.isPending}
        onClick={() => {
          start.mutate();
          onNavigate?.();
        }}
      >
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        新对话
      </button>

      <div className={styles.group}>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={linkClass} onClick={onNavigate}>
            <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>最近对话</span>
        {conversations.data?.length === 0 && <span className={styles.hint}>还没有对话</span>}
        {conversations.data?.map((c) => (
          <NavLink
            key={c.id}
            to={`/c/${c.id}`}
            className={linkClass}
            onClick={onNavigate}
            title={c.title ?? "新对话"}
          >
            <span className={styles.ellipsis}>{c.title ?? "新对话"}</span>
          </NavLink>
        ))}
      </div>

      <div className={styles.user}>
        <span className={styles.avatar} aria-hidden="true">
          {name.slice(0, 1)}
        </span>
        <span className={styles.userName}>{name}</span>
        <NotificationsBell />
      </div>
    </nav>
  );
}
