import { FileUp } from "lucide-react";
import styles from "./ImportPrompt.module.css";

export function ImportPrompt({ onImport, className }: { onImport: () => void; className?: string }) {
  return (
    <button type="button" className={[styles.card, className].filter(Boolean).join(" ")} onClick={onImport}>
      <span className={styles.icon} aria-hidden="true">
        <FileUp size={18} strokeWidth={1.7} />
      </span>
      <span className={styles.main}>
        <span className={styles.title}>已有简历？导入后只补缺的</span>
        <span className={styles.note}>上传 PDF / Word 或粘贴文字，读到的内容逐条确认后写入，不用从头讲</span>
      </span>
      <span className={styles.cta}>导入简历</span>
    </button>
  );
}
