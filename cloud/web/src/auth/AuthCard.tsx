import { Logo } from "@talksume/web/components/Logo.tsx";
import type { ReactNode } from "react";
import styles from "./Auth.module.css";

export function AuthPage({
  title,
  lead,
  children,
  footer,
  wide,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={styles.page}>
      <Logo size={20} />
      <div className={[styles.card, wide && styles.wide].filter(Boolean).join(" ")}>
        <h1 className={styles.title}>{title}</h1>
        {lead && <p className={styles.lead}>{lead}</p>}
        {children}
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}

export function FormError({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p className={styles.error} role="alert">
      {error.message}
    </p>
  );
}
