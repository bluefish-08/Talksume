import { Check } from "lucide-react";
import { useResumeStyle, useSaveResumeStyle } from "../resume/queries.ts";
import styles from "./DesignOptions.module.css";
import type { DesignOption } from "./types.ts";

const canon = (v: unknown): unknown =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(
        Object.entries(v)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, canon(x)]),
      )
    : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** 点选才保存：缩略图是服务端按用户自己的简历渲染的，选中后继续在对话里微调。 */
export function DesignOptions({ options }: { options: DesignOption[] }) {
  const { style } = useResumeStyle();
  const save = useSaveResumeStyle();
  return (
    <section className={styles.wrap} aria-label="设计方案">
      <ul className={styles.list}>
        {options.map((o) => {
          const current = same(style.theme, o.style.theme) && same(style.css, o.style.css);
          return (
            <li key={o.id} className={styles.card} data-current={current || undefined}>
              <img className={styles.thumb} src={o.thumbnail} alt={`${o.name}：${o.summary}`} />
              <span className={styles.name}>{o.name}</span>
              <span className={styles.summary}>{o.summary}</span>
              {o.ats && !o.ats.ok && <span className={styles.warn}>网申系统可能读不全</span>}
              <button
                type="button"
                className={styles.pick}
                disabled={current || save.isPending}
                onClick={() => save.mutate(o.style)}
              >
                {current ? (
                  <>
                    <Check size={14} strokeWidth={2} aria-hidden="true" /> 使用中
                  </>
                ) : (
                  "用这版"
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
