import { cloneElement, type ReactElement, useId } from "react";
import styles from "./Field.module.css";

interface Props {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}

/** 标签、提示、错误文案与控件的关联集中在这里。 */
export function Field({ label, hint, error, required, children }: Props) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required && (
          <span className={styles.req} aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": note ? noteId : undefined,
      })}
      {note && (
        <span id={noteId} className={error ? styles.error : styles.hint} role={error ? "alert" : undefined}>
          {note}
        </span>
      )}
    </div>
  );
}
