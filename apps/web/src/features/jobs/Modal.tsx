import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { IconButton } from "../../components/ui.tsx";
import styles from "./Modal.module.css";

/** 基于原生 dialog：自带焦点圈定和 Esc 关闭；卸载时把焦点还给打开它的按钮。 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement;
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.panel}>
        <header className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <IconButton label="关闭" onClick={onClose}>
            <X size={18} strokeWidth={1.6} aria-hidden="true" />
          </IconButton>
        </header>
        {children}
      </div>
    </dialog>
  );
}
