import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import styles from "./ModelPicker.module.css";
import { useModelChoice } from "./modelChoice.ts";

const THINKING = [
  { value: true, label: "开启", note: "（推荐）" },
  { value: false, label: "关闭", note: "" },
];

export function ModelPicker() {
  const { options, choice, setChoice } = useModelChoice();
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    root.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  useEffect(() => {
    if (!open) setSub(false);
  }, [open]);

  if (!options || !choice) return null;
  const current = options.models.find((m) => m.id === choice.model);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (sub) {
        setSub(false);
        root.current?.querySelector<HTMLElement>("[data-thinking]")?.focus();
      } else close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const scope = sub
      ? root.current?.querySelector('[role="menu"][data-sub]')
      : root.current?.querySelector('[role="menu"]:not([data-sub])');
    const items = [...(scope?.querySelectorAll<HTMLElement>(":scope > [role^='menuitem']") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  const openSub = (focus: boolean) => {
    setSub(true);
    if (focus) {
      requestAnimationFrame(() =>
        root.current?.querySelector<HTMLElement>("[data-sub] [aria-checked='true']")?.focus(),
      );
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 键盘事件从菜单项冒泡上来统一处理
    <div className={styles.root} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.triggerLabel}>{current?.label ?? choice.model}</span>
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.menu} role="menu" aria-label="选择模型">
          {options.models.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitemradio"
              aria-checked={m.id === choice.model}
              className={styles.item}
              onMouseEnter={() => setSub(false)}
              onClick={() => {
                setChoice({ model: m.id });
                close();
              }}
            >
              <span className={styles.text}>
                <span className={styles.name}>{m.label}</span>
                {m.hint && <span className={styles.hint}>{m.hint}</span>}
              </span>
              <span className={styles.check}>
                {m.id === choice.model && <Check size={16} strokeWidth={2} aria-hidden="true" />}
              </span>
            </button>
          ))}
          <hr className={styles.sep} />
          <button
            type="button"
            role="menuitem"
            data-thinking
            aria-haspopup="menu"
            aria-expanded={sub}
            className={`${styles.item} ${styles.row}`}
            onMouseEnter={() => openSub(false)}
            onClick={() => openSub(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                openSub(true);
              }
            }}
          >
            <span className={styles.name}>思考</span>
            <span className={styles.state}>
              {choice.thinking ? "开启" : "关闭"}
              <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
            </span>
          </button>
          {sub && (
            <div className={styles.submenu} role="menu" aria-label="思考" data-sub>
              {THINKING.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  role="menuitemradio"
                  aria-checked={t.value === choice.thinking}
                  className={styles.item}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      setSub(false);
                      root.current?.querySelector<HTMLElement>("[data-thinking]")?.focus();
                    }
                  }}
                  onClick={() => {
                    setChoice({ thinking: t.value });
                    close();
                  }}
                >
                  <span className={styles.name}>
                    {t.label}
                    {t.note && <span className={styles.note}>{t.note}</span>}
                  </span>
                  <span className={styles.check}>
                    {t.value === choice.thinking && <Check size={16} strokeWidth={2} aria-hidden="true" />}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
