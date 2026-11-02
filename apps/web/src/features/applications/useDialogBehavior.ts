import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Options {
  lockScroll?: boolean;
  /** 关闭后把焦点还给它；缺省回到打开前的焦点元素。 */
  returnFocus?: () => HTMLElement | null | undefined;
}

/** 对话框的键盘行为：进入时聚焦、Esc 关闭、Tab 不出框、关闭后焦点归位。 */
export function useDialogBehavior(
  panel: RefObject<HTMLElement | null>,
  onClose: () => void,
  { lockScroll = false, returnFocus }: Options = {},
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;

  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const opener = returnRef.current?.() ?? (document.activeElement as HTMLElement | null);
    const prevOverflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = "hidden";
    node.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const head = items[0];
      const tail = items[items.length - 1];
      if (!head || !tail) return;
      const active = document.activeElement;
      if (!node.contains(active)) {
        e.preventDefault();
        head.focus();
      } else if (e.shiftKey && (active === head || active === node)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && active === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [panel, lockScroll]);
}
