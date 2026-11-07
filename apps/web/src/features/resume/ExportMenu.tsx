import { Download } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Spinner } from "../../components/ui.tsx";
import { useAdoptedTailorings } from "../tailor/queries.ts";
import styles from "./ExportMenu.module.css";
import { type ExportFormat, type TriggerSize, useExportResume } from "./queries.ts";

const OPTIONS: { format: ExportFormat; label: string }[] = [
  { format: "pdf", label: "PDF（.pdf）" },
  { format: "docx", label: "Word（.docx）" },
];

export function ExportMenu({ size = "sm", icon = false }: { size?: TriggerSize; icon?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { exportAs, busy } = useExportResume();
  const tailored = useAdoptedTailorings().data ?? [];

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
        className={[styles.trigger, size === "md" && styles.md, icon && styles.icon]
          .filter(Boolean)
          .join(" ")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={icon ? "导出" : undefined}
        disabled={busy !== null}
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? <Spinner label="正在导出" /> : <Download size={15} strokeWidth={1.8} aria-hidden="true" />}
        {!icon && "导出"}
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {tailored.length > 0 && <div className={styles.group}>通用简历</div>}
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
          {tailored.map((t) => (
            <Fragment key={t.resumeVersionId}>
              <div className={styles.group}>
                定制版 · {t.company} {t.title}
              </div>
              {OPTIONS.map(({ format, label }) => (
                <button
                  key={format}
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  onClick={() => {
                    setOpen(false);
                    void exportAs(format, t.resumeVersionId);
                  }}
                >
                  {label}
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
