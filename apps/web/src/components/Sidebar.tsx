import { FileText, ListChecks, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { NavLink, useMatch, useNavigate } from "react-router";
import {
  useConversations,
  useDeleteConversation,
  useProfile,
  useRenameConversation,
  useRestoreConversation,
} from "../api/queries.ts";
import type { ConversationSummary } from "../api/types.ts";
import { getExtensions } from "../extensions.ts";
import { Modal } from "../features/jobs/Modal.tsx";
import { NotificationsBell } from "../features/notifications/NotificationsBell.tsx";
import { Logo } from "./Logo.tsx";
import styles from "./Sidebar.module.css";
import { useToast } from "./Toast.tsx";
import { Button } from "./ui.tsx";

const NAV = [
  { to: "/resume", label: "我的简历", icon: FileText },
  { to: "/jobs", label: "职位推荐", icon: Search },
  { to: "/applications", label: "投递进度", icon: ListChecks },
] as const;

export const linkClass = ({ isActive }: { isActive: boolean }) =>
  [styles.link, isActive && styles.active].filter(Boolean).join(" ");

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const conversations = useConversations();
  const profile = useProfile();
  const { SidebarLinks, SidebarAccount, useAccount } = getExtensions();
  const account = useAccount?.();
  const name = profile.data?.profile.basics.name || account?.displayName || "我";

  return (
    <nav aria-label="侧边栏" className={styles.sidebar}>
      <div className={styles.brand}>
        <NavLink to="/" onClick={onNavigate} aria-label="简聊首页" className={styles.brandLink}>
          <Logo />
        </NavLink>
      </div>

      {/* 只回到首页输入框，发出第一句话时才建对话，避免连点堆出空对话 */}
      <NavLink to="/" end className={styles.newChat} onClick={onNavigate}>
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        新对话
      </NavLink>

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
          <ConversationItem key={c.id} conversation={c} onNavigate={onNavigate} />
        ))}
      </div>

      {SidebarLinks && (
        <div className={styles.group}>
          <SidebarLinks onNavigate={onNavigate} />
        </div>
      )}

      <div className={styles.user}>
        <span className={styles.avatar} aria-hidden="true">
          {name.slice(0, 1)}
        </span>
        <span className={styles.userText}>
          <span className={styles.userName}>{name}</span>
          {account && <span className={styles.userEmail}>{account.email}</span>}
        </span>
        <NotificationsBell />
        {SidebarAccount && <SidebarAccount />}
      </div>
    </nav>
  );
}

function ConversationItem({
  conversation: c,
  onNavigate,
}: {
  conversation: ConversationSummary;
  onNavigate?: (() => void) | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const rename = useRenameConversation();
  const remove = useDeleteConversation();
  const restore = useRestoreConversation();
  const toast = useToast();
  const navigate = useNavigate();
  const isCurrent = useMatch(`/c/${c.id}`) !== null;
  const label = c.title ?? "新对话";

  const fail = (error: Error) => toast(error.message, { tone: "error" });
  const undo = () => restore.mutateAsync(c.id).catch(fail);
  // 成功后列表项会卸载，mutate 的回调不再触发，所以用 promise 接后续
  const confirmDelete = () => {
    setConfirming(false);
    remove.mutateAsync(c.id).then(() => {
      if (isCurrent) navigate("/", { replace: true });
      toast("已删除", { action: { label: "撤销", onClick: undo }, ms: 10_000 });
    }, fail);
  };

  const commit = (value: string) => {
    setEditing(false);
    const title = value.replace(/\s+/g, " ").trim();
    if (!title || title === c.title) return;
    rename.mutate({ id: c.id, title }, { onError: (error) => toast(error.message, { tone: "error" }) });
  };

  if (editing)
    return <RenameInput initial={c.title ?? ""} onCommit={commit} onCancel={() => setEditing(false)} />;

  return (
    <div className={styles.item}>
      <NavLink
        to={`/c/${c.id}`}
        className={linkClass}
        onClick={onNavigate}
        title={label}
        onContextMenu={(e) => {
          e.preventDefault();
          setEditing(true);
        }}
      >
        <span className={styles.ellipsis}>{label}</span>
      </NavLink>
      <button
        type="button"
        className={`${styles.itemAction} ${styles.itemRename}`}
        aria-label={`重命名「${label}」`}
        title="重命名"
        onClick={() => setEditing(true)}
      >
        <Pencil size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.itemAction}
        aria-label={`删除「${label}」`}
        title="删除"
        onClick={() => setConfirming(true)}
      >
        <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {confirming && (
        <Modal title="删除这段对话？" onClose={() => setConfirming(false)}>
          <p className={styles.confirmText}>
            删除这段对话的聊天记录。已经写进简历的内容会保留，可以在『我的简历』里修改。
          </p>
          <div className={styles.confirmActions}>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              取消
            </Button>
            <Button variant="dark" className={styles.confirmDanger} onClick={confirmDelete}>
              删除
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const settled = useRef(false);
  const finish = (fn: () => void) => {
    if (settled.current) return;
    settled.current = true;
    fn();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") finish(() => onCommit(e.currentTarget.value));
    if (e.key === "Escape") finish(onCancel);
  };

  return (
    <input
      className={styles.renameInput}
      aria-label="会话标题"
      defaultValue={initial}
      maxLength={40}
      // biome-ignore lint/a11y/noAutofocus: 用户刚点了重命名，焦点就该落在输入框
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        const value = e.currentTarget.value;
        finish(() => onCommit(value));
      }}
    />
  );
}
