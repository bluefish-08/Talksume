import { ArrowRight, Lightbulb } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./SuggestionsMenu.module.css";
import type { ResumeSuggestion } from "./workbench.ts";

interface Props {
  suggestions: readonly ResumeSuggestion[];
  onPick: (prompt: string) => void;
}

export function SuggestionsMenu({ suggestions, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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

  if (suggestions.length === 0) return null;
  return (
    <div className={styles.root} ref={root}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Lightbulb size={13} strokeWidth={1.8} aria-hidden="true" />
        {suggestions.length} 项可补充
      </button>
      {open && (
        <div className={styles.popover}>
          <h2 className={styles.title}>还可以补充</h2>
          <ul className={styles.list}>
            {suggestions.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className={styles.item}
                  onClick={() => {
                    setOpen(false);
                    onPick(s.prompt);
                  }}
                >
                  <span>{s.title}</span>
                  <span className={styles.action}>
                    让助手追问
                    <ArrowRight size={13} strokeWidth={1.8} aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
