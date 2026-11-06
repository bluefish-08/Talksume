import { Logo, LogoMark } from "@talksume/web/components/Logo.tsx";
import { Button } from "@talksume/web/components/ui.tsx";
import type { ComponentProps, ReactNode } from "react";
import styles from "./Auth.module.css";

function Slogan({ className }: { className?: string }) {
  return (
    <div className={[styles.slogan, className].filter(Boolean).join(" ")}>
      <svg className={styles.cornerTl} viewBox="0 0 100 100" aria-hidden="true">
        <path d="M0 0h64v10H10v54H0z" fill="var(--brand)" />
      </svg>
      <svg className={styles.cornerBr} viewBox="0 0 100 100" aria-hidden="true">
        <path d="M100 100H36V90h54V36h10z" fill="var(--brand-sky)" />
      </svg>
      <p className={styles.sloganText}>
        简历、岗位、投递，
        <br />
        一站搞定。
      </p>
    </div>
  );
}

export function AuthPage({
  title,
  lead,
  children,
  footer,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <aside className={styles.hero}>
        <Logo size={22} />
        <Slogan className={styles.heroSlogan} />
        <p className={styles.heroFoot}>一站式求职工作台</p>
      </aside>
      <div className={styles.side}>
        <div className={styles.mobileHead}>
          <Logo size={20} />
          <Slogan className={styles.mobileSlogan} />
        </div>
        <main className={styles.stage}>
          <div className={styles.authCard}>
            <header className={styles.cardHead}>
              <span className={styles.cardMark}>
                <LogoMark size={40} />
              </span>
              <h1 className={styles.cardTitle}>{title}</h1>
              {lead && <p className={styles.cardLead}>{lead}</p>}
            </header>
            {children}
            {footer && <div className={styles.cardFooter}>{footer}</div>}
          </div>
        </main>
        <p className={styles.copy}>© 2026 简聊 Talksume</p>
      </div>
    </div>
  );
}

export function AuthButton({ className, ...rest }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="dark"
      size="lg"
      className={[styles.action, className].filter(Boolean).join(" ")}
      {...rest}
    />
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
