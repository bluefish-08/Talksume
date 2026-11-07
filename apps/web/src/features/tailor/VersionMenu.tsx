import { ChevronDown } from "lucide-react";
import { Fragment, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { menuKeyAction, type TailorStatus, versionMenuItems } from "../chat/tailorCards.ts";
import styles from "./VersionMenu.module.css";

interface Props {
  company: string;
  changes: number;
  status: TailorStatus;
  showing: boolean;
  onShow: (showing: boolean) => void;
  onRevoke: () => void;
  onDiscard: () => void;
}

export function VersionMenu({ company, changes, status, showing, onShow, onRevoke, onDiscard }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = versionMenuItems({ company, changes, status, showingTailored: showing });
  const dot = status === "adopted" ? "adopted" : status === "draft" ? "draft" : "none";
  const label =
    status === "revoked"
      ? "主简历 · 已改回"
      : `${company}定制版 · ${status === "adopted" ? "已采用" : "草稿"}`;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')?.focus();
  }, [open]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const action = menuKeyAction(e.key);
    if (!action) return;
    e.preventDefault();
    if (action === "close") return close(true);
    const nodes = [
      ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? []),
    ];
    if (nodes.length === 0) return;
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    const next =
      action === "next"
        ? (at + 1 + nodes.length) % nodes.length
        : action === "prev"
          ? (at - 1 + nodes.length) % nodes.length
          : action === "first"
            ? 0
            : nodes.length - 1;
    nodes[next]?.focus();
  };

  const onTriggerKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    setOpen(true);
  };

  const choose = (id: string) => {
    close(true);
    if (id === "main") onShow(false);
    else if (id === "tailored") onShow(true);
    else if (status === "adopted") onRevoke();
    else onDiscard();
  };

  return (
    <div className={styles.root} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        data-status={status}
        data-dot={dot}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {dot !== "none" && <span className={styles.dot} data-status={dot} aria-hidden="true" />}
        <span className={styles.text}>{label}</span>
        <ChevronDown size={12} strokeWidth={2.4} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={menu}
          className={styles.menu}
          role="menu"
          aria-label="简历版本"
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          {items.map((item) =>
            item.kind === "radio" ? (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={item.checked}
                className={styles.item}
                data-checked={item.checked}
                onClick={() => choose(item.id)}
              >
                <span className={styles.radio} data-checked={item.checked} aria-hidden="true" />
                <span className={styles.itemText}>
                  <span className={styles.itemLabel}>{item.label}</span>
                  <span className={styles.itemDetail}>{item.detail}</span>
                </span>
              </button>
            ) : (
              <Fragment key={item.id}>
                <hr className={styles.separator} />
                <button
                  type="button"
                  role="menuitem"
                  className={styles.action}
                  data-danger={item.danger}
                  onClick={() => choose(item.id)}
                >
                  {item.label}
                </button>
              </Fragment>
            ),
          )}
        </div>
      )}
    </div>
  );
}
