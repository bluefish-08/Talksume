import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import { useToast } from "../../components/Toast.tsx";
import styles from "./PolishButton.module.css";
import { PolishReview } from "./PolishReview.tsx";
import { usePolishActions, usePolishState } from "./polishQueries.ts";

export function PolishButton() {
  const state = usePolishState();
  const { polish } = usePolishActions();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [params, setParams] = useSearchParams();

  const entries = state.data?.entries ?? [];
  const available = state.data?.available ?? false;
  const stale = entries.filter((e) => e.stale).length;
  const disabledReason = !state.data
    ? undefined
    : !available
      ? "还没有配置模型，暂时不能润色"
      : entries.length === 0
        ? "还没有可润色的经历要点，先和助手聊聊项目或实习"
        : undefined;

  const start = () => {
    setOpen(true);
    if (entries.some((e) => !e.polish)) {
      polish.mutate(undefined, {
        onError: (error) =>
          toast(error instanceof ApiError ? error.message : "润色失败，请稍后再试", { tone: "error" }),
      });
    } else {
      void state.refetch();
    }
  };

  const deepLinked = useRef(false);
  useEffect(() => {
    if (params.get("polish") !== "1" || !state.data || deepLinked.current) return;
    deepLinked.current = true;
    setParams(
      (p) => {
        p.delete("polish");
        return p;
      },
      { replace: true },
    );
    if (!disabledReason) start();
  });

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        disabled={!state.data || !!disabledReason}
        title={
          disabledReason ??
          (stale > 0 ? `${stale} 条要点原文已更新，可以重新润色` : "把经历要点改写成简历风格")
        }
        onClick={start}
      >
        <Sparkles size={15} strokeWidth={1.8} aria-hidden="true" />
        润色
        {stale > 0 && <span className={styles.dot} aria-hidden="true" />}
      </button>
      {open && <PolishReview polishingAll={polish.isPending} onClose={() => setOpen(false)} />}
    </>
  );
}
