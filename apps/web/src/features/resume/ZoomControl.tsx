import { Minus, Plus } from "lucide-react";
import { stepZoom, ZOOM_MAX, ZOOM_MIN, type ZoomMode } from "./workbench.ts";
import styles from "./ZoomControl.module.css";

interface Props {
  mode: ZoomMode;
  /** 当前实际缩放比例，适配档位下也是算出来的值。 */
  scale: number;
  onChange: (mode: ZoomMode) => void;
}

export function ZoomControl({ mode, scale, onChange }: Props) {
  const pct = Math.round(scale * 100);
  return (
    <div className={styles.root} role="toolbar" aria-label="简历缩放">
      <button
        type="button"
        className={styles.fit}
        aria-pressed={mode === "page"}
        onClick={() => onChange("page")}
      >
        适合页面
      </button>
      <button
        type="button"
        className={styles.fit}
        aria-pressed={mode === "width"}
        onClick={() => onChange("width")}
      >
        适合宽度
      </button>
      <span className={styles.sep} aria-hidden="true" />
      <button
        type="button"
        className={styles.step}
        aria-label="缩小"
        disabled={pct <= ZOOM_MIN}
        onClick={() => onChange(stepZoom(scale, -1))}
      >
        <Minus size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <output className={styles.pct} aria-live="polite">
        {pct}%
      </output>
      <button
        type="button"
        className={styles.step}
        aria-label="放大"
        disabled={pct >= ZOOM_MAX}
        onClick={() => onChange(stepZoom(scale, 1))}
      >
        <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  );
}
