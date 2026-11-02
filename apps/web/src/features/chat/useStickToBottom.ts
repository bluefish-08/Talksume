import { type UIEvent, useCallback, useLayoutEffect, useRef } from "react";

const NEAR_BOTTOM_PX = 120;

/** 用户停在底部附近时，内容变化后自动贴底；往上翻看历史时不打扰。 */
export function useStickToBottom(content: unknown, extra?: unknown, visible = true) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 由调用方传入需要触发贴底的数据
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [content, extra, visible]);

  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  const pin = useCallback(() => {
    stick.current = true;
  }, []);

  return { ref, onScroll, pin };
}
