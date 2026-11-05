import styles from "./VersionSwitch.module.css";

/** 在通用简历和某个岗位的定制版之间切换预览。 */
export function VersionSwitch({
  label,
  showing,
  onShow,
  className,
}: {
  label: string;
  showing: boolean;
  onShow: (showing: boolean) => void;
  className?: string;
}) {
  return (
    <fieldset className={[styles.versions, className].filter(Boolean).join(" ")} aria-label="简历版本">
      <button type="button" className={styles.version} aria-pressed={!showing} onClick={() => onShow(false)}>
        通用简历
      </button>
      <button type="button" className={styles.version} aria-pressed={showing} onClick={() => onShow(true)}>
        {label} 定制版
      </button>
    </fieldset>
  );
}
