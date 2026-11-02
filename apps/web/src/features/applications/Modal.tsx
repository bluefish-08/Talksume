import { X } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "../../components/ui.tsx";
import styles from "./Modal.module.css";
import { useDialogBehavior } from "./useDialogBehavior.ts";

interface Props {
  title: string;
  variant?: "drawer" | "dialog";
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** 抽屉 / 居中对话框。不支持叠放：需要二次确认时在面板内换内容。 */
export function Modal({ title, variant = "dialog", wide, onClose, children, footer }: Props) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useDialogBehavior(panel, onClose, { lockScroll: true });

  return createPortal(
    <div className={[styles.root, styles[variant], wide && styles.wide].filter(Boolean).join(" ")}>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <IconButton label="关闭" onClick={onClose}>
            <X size={18} strokeWidth={1.6} aria-hidden="true" />
          </IconButton>
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.foot}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
