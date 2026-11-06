import {
  cloneElement,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  useId,
  useState,
} from "react";
import styles from "./Auth.module.css";

type ControlProps = { id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string };

export function AuthField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactElement<ControlProps>;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {hint && (
          <span id={hintId} className={styles.hint}>
            {hint}
          </span>
        )}
      </div>
      {cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {error && (
        <span id={errorId} className={styles.fieldError} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function useReveal() {
  const [shown, setShown] = useState(false);
  return { shown, toggle: () => setShown((v) => !v) };
}

export function PasswordInput({
  shown,
  onToggle,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { shown: boolean; onToggle?: () => void }) {
  return (
    <div className={styles.passwordWrap}>
      <input
        {...rest}
        type={shown ? "text" : "password"}
        className={onToggle ? styles.withToggle : undefined}
      />
      {onToggle && (
        <button
          type="button"
          className={styles.reveal}
          aria-label={shown ? "隐藏密码" : "显示密码"}
          aria-pressed={shown}
          onClick={onToggle}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {shown ? (
              <>
                <path d="M3 3l18 18" />
                <path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9" />
                <path d="M6.6 6.6C3.9 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
                <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
              </>
            ) : (
              <>
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </svg>
        </button>
      )}
    </div>
  );
}
