import { useId } from "react";
import type { ResumeContent } from "../../api/types.ts";
import styles from "./ResumePreview.module.css";

export interface FactQuote {
  quote: string;
  /** 这句原话是用户第几轮说的；无法确定时省略。 */
  round?: number;
}

type ResumeItem = ResumeContent["sections"][number]["items"][number];

interface Props {
  resume: ResumeContent;
  /** 刚写入的条目标题或要点原文，命中的会高亮并带「刚刚添加」标记。 */
  highlightTexts?: ReadonlySet<string>;
  /** factId → 原话，用于悬停溯源。 */
  facts?: Readonly<Record<string, FactQuote>>;
  /** 还没内容的分区标题，渲染为浅色占位。 */
  placeholders?: readonly string[];
}

export function ResumePreview({ resume, highlightTexts, facts, placeholders = [] }: Props) {
  const { basics, sections } = resume;
  const empty = !basics.name && sections.length === 0;
  return (
    <article className={styles.page} aria-label="简历预览">
      <header className={styles.head}>
        <span className={basics.name ? styles.name : `${styles.name} ${styles.nameEmpty}`}>
          {basics.name || "你的姓名"}
        </span>
        {basics.contacts.length > 0 && (
          <span className={styles.contacts}>
            {basics.contacts.map((c, i) => (
              <span key={c}>
                {i > 0 && <span className={styles.sep}>|</span>}
                {c}
              </span>
            ))}
          </span>
        )}
        {basics.summary && <span className={styles.summary}>{basics.summary}</span>}
      </header>

      {sections.map((section) => (
        <section key={`${section.kind}:${section.title}`} className={styles.section}>
          <h3 className={styles.title}>{section.title}</h3>
          {section.items.map((item, i) => (
            <Item
              // biome-ignore lint/suspicious/noArrayIndexKey: 条目没有稳定 id，同分区内标题可能重复
              key={`${item.heading}:${i}`}
              item={item}
              inline={section.kind === "skills"}
              highlightTexts={highlightTexts}
              facts={facts}
            />
          ))}
        </section>
      ))}

      {placeholders.map((title) => (
        <section key={title} className={`${styles.section} ${styles.placeholder}`} aria-hidden="true">
          <h3 className={`${styles.title} ${styles.titleEmpty}`}>{title}</h3>
          <div className={styles.bar} style={{ width: "72%" }} />
          <div className={styles.bar} style={{ width: "50%" }} />
        </section>
      ))}

      {empty && placeholders.length === 0 && (
        <p className={styles.blank}>聊几句之后，简历会在这里一点点长出来。</p>
      )}
    </article>
  );
}

function Item({
  item,
  inline,
  highlightTexts,
  facts,
}: {
  item: ResumeItem;
  /** 技能条目：标题与要点同一行。 */
  inline: boolean;
  highlightTexts: ReadonlySet<string> | undefined;
  facts: Props["facts"];
}) {
  const itemNew = highlightTexts?.has(item.heading) ?? false;
  return (
    <div className={inline ? `${styles.item} ${styles.inline}` : styles.item}>
      {(!inline || item.heading) && (
        <div className={itemNew ? `${styles.row} ${styles.hl}` : styles.row}>
          <span className={styles.heading}>
            {item.heading}
            {inline && "："}
            {item.subheading && <span className={styles.sub}>{item.subheading}</span>}
          </span>
          {item.period && <span className={styles.period}>{item.period}</span>}
          {itemNew && <span className={styles.tag}>刚刚添加</span>}
        </div>
      )}
      {item.bullets.length > 0 && (
        <ul className={styles.bullets}>
          {item.bullets.map((b, i) => {
            const own = highlightTexts?.has(b.text) ?? false;
            return (
              <Bullet
                // biome-ignore lint/suspicious/noArrayIndexKey: 同一条目下要点原文可能重复
                key={`${b.text}:${i}`}
                text={b.text}
                factIds={b.factIds}
                highlighted={itemNew || own}
                tagged={!itemNew && own}
                facts={facts}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Bullet({
  text,
  factIds,
  highlighted,
  tagged,
  facts,
}: {
  text: string;
  factIds: string[];
  highlighted: boolean;
  tagged: boolean;
  facts: Props["facts"];
}) {
  const popId = useId();
  const sources = [
    ...new Map(
      factIds.flatMap((id) => {
        const f = facts?.[id];
        return f?.quote ? [[f.quote, f] as const] : [];
      }),
    ).values(),
  ].slice(0, 3);
  const traceable = sources.length > 0;
  const round = sources.length === 1 ? sources[0]?.round : undefined;

  return (
    <li
      className={[styles.bullet, highlighted && styles.hl, traceable && styles.traceable]
        .filter(Boolean)
        .join(" ")}
      // 键盘聚焦也要能看到出处
      tabIndex={traceable ? 0 : undefined}
      aria-describedby={traceable ? popId : undefined}
    >
      {text}
      {tagged && <span className={styles.tag}>刚刚添加</span>}
      {traceable && (
        <div id={popId} role="tooltip" className={styles.pop}>
          <span className={styles.popHead}>出自你的原话{round ? ` · 第 ${round} 轮` : ""}</span>
          {sources.map((s) => (
            <span key={s.quote}>「{s.quote}」</span>
          ))}
        </div>
      )}
    </li>
  );
}
