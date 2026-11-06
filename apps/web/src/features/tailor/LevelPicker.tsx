import { TAILOR_LEVEL_LABELS, TAILOR_LEVELS, type TailorLevel } from "@talksume/core";
import { useId } from "react";
import styles from "./LevelPicker.module.css";

interface Props {
  value: TailorLevel;
  onChange: (level: TailorLevel) => void;
  disabled?: boolean;
}

/** 三档共用同一套出处校验：档位越高措辞越自由，但都不能新增事实。 */
export function LevelPicker({ value, onChange, disabled }: Props) {
  const name = useId();
  return (
    <fieldset className={styles.root} disabled={disabled}>
      <legend className={styles.legend}>定制档位</legend>
      <div className={styles.options}>
        {TAILOR_LEVELS.map((level) => {
          const { name: label, hint } = TAILOR_LEVEL_LABELS[level];
          return (
            <label key={level} className={styles.option} data-checked={value === level || undefined}>
              <input type="radio" name={name} checked={value === level} onChange={() => onChange(level)} />
              <span className={styles.label}>{label}</span>
              <span className={styles.hint}>{hint}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
