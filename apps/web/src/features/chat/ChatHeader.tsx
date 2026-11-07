import { FileText } from "lucide-react";
import styles from "./ChatView.module.css";

export function ChatHeader({
  title,
  pct,
  onOpenPane,
}: {
  title: string;
  pct: number;
  onOpenPane: () => void;
}) {
  return (
    <header className={styles.head}>
      <h1 className={styles.title}>{title}</h1>
      <span className={styles.grow} />
      <button type="button" className={styles.paneToggle} onClick={onOpenPane}>
        <FileText size={16} strokeWidth={1.6} aria-hidden="true" />
        简历 {pct}%
      </button>
    </header>
  );
}
