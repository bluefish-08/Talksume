import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import styles from "./Toast.module.css";

type Tone = "info" | "success" | "error";

interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
  action?: { label: string; onClick: () => void };
}

type Show = (text: string, opts?: { tone?: Tone; action?: ToastItem["action"]; ms?: number }) => void;

const ToastContext = createContext<Show>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback<Show>(
    (text, opts = {}) => {
      const id = ++seq.current;
      setItems((all) => [...all.slice(-2), { id, text, tone: opts.tone ?? "info", action: opts.action }]);
      setTimeout(() => dismiss(id), opts.ms ?? 4000);
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.stack} aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={[styles.toast, styles[t.tone]].join(" ")}>
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
