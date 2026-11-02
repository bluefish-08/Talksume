import styles from "./Logo.module.css";

export function Logo({ size = 19 }: { size?: number }) {
  return (
    <span className={styles.logo} style={{ fontSize: size }}>
      <svg
        className={styles.mark}
        width={size * 0.8}
        height={size * 0.8}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="square"
        aria-hidden="true"
      >
        <path d="M17 3.5H6.5V16" />
      </svg>
      <span className={styles.word}>简聊</span>
    </span>
  );
}
