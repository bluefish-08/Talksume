import styles from "./Logo.module.css";

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <span className={styles.logo} style={{ fontSize: size }}>
      <LogoMark size={Math.round(size * 1.2)} />
      <span className={styles.word}>简聊</span>
    </span>
  );
}

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg className={styles.mark} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M7 7h21v8H15v17H7z" fill="var(--brand)" />
      <path d="M41 41H20v-8h13V16h8z" fill="var(--brand-sky)" />
    </svg>
  );
}
