import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "../../components/ui.tsx";
import styles from "./ExportMenu.module.css";
import { type ExportFormat, type TriggerSize, useExportResume } from "./queries.ts";

const OPTIONS: { format: ExportFormat; label: string }[] = [
  { format: "pdf", label: "PDF（.pdf）" },
  { format: "docx", label: "Word（.docx）" },
];

export function ExportMenu({ size = "sm" }: { size?: TriggerSize }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { exportAs, busy } = useExportResume();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={root}>
      <button
        type="button"
        className={size === "md" ? `${styles.trigger} ${styles.md}` : styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy !== null}
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? <Spinner label="正在导出" /> : <Download size={15} strokeWidth={1.8} aria-hidden="true" />}
        导出
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {OPTIONS.map(({ format, label }) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                setOpen(false);
                void exportAs(format);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
