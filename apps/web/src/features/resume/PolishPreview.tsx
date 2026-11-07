import type { ResumeStyle } from "@talksume/core";
import { useEffect, useRef } from "react";
import type { ResumeContent } from "../../api/types.ts";
import { useToast } from "../../components/Toast.tsx";
import { Button, Spinner } from "../../components/ui.tsx";
import styles from "./PolishPreview.module.css";
import { usePolishActions, usePolishPreview } from "./polishQueries.ts";
import { ResumePreview } from "./ResumePreview.tsx";

/** 从有待定变成 0 时自动退出预览；本来就是 0 打开的不算。 */
export function shouldClosePolishPreview(previous: number, current: number): boolean {
  return previous > 0 && current === 0;
}

interface Props {
  resume: ResumeContent;
  resumeStyle?: ResumeStyle | undefined;
  scale?: number | undefined;
  onClose: () => void;
}

/** 把待定的润色建议叠在简历上，编号和聊天卡片一致。 */
export function PolishPreview({ resume, resumeStyle, scale, onClose }: Props) {
  const preview = usePolishPreview(resume);
  const { decide } = usePolishActions();
  const toast = useToast();
  const lastPending = useRef(preview.pending);

  useEffect(() => {
    if (shouldClosePolishPreview(lastPending.current, preview.pending)) onClose();
    lastPending.current = preview.pending;
  }, [preview.pending, onClose]);

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <span className={styles.label}>润色预览 · {preview.pending} 处待定</span>
        <span className={styles.grow} />
        <Button
          variant="dark"
          size="sm"
          disabled={preview.ids.length === 0 || decide.isPending}
          onClick={() =>
            decide.mutate(
              { ids: preview.ids, action: "accept" },
              {
                onSuccess: () => toast("已采用这些润色", { tone: "success" }),
                onError: () => toast("操作失败，请稍后再试", { tone: "error" }),
              },
            )
          }
        >
          {decide.isPending && <Spinner label="采用中" />}都用上
        </Button>
        <Button size="sm" onClick={onClose}>
          关闭
        </Button>
      </div>
      <ResumePreview
        resume={preview.resume}
        resumeStyle={resumeStyle}
        changeMarks={preview.marks}
        label="润色预览"
        {...(scale !== undefined && { scale })}
      />
    </div>
  );
}
