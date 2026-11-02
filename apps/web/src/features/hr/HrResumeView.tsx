import { type ResumeContent, skillLine } from "@talksume/core";
import styles from "./HrResumeView.module.css";

export function HrResumeView({ content }: { content: ResumeContent }) {
  const { basics, sections } = content;
  return (
    <article className={styles.paper} aria-label={`${basics.name}的简历`}>
      <header className={styles.head}>
        <h3 className={styles.name}>{basics.name}</h3>
        {basics.contacts.length > 0 && <p className={styles.contacts}>{basics.contacts.join(" · ")}</p>}
        {basics.summary && <p className={styles.summary}>{basics.summary}</p>}
      </header>
      {sections.map((section, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 简历内容只读，不会重排
        <section key={`${section.kind}-${i}`} className={styles.section}>
          <h4 className={styles.sectionTitle}>{section.title}</h4>
          {section.items.map((item, j) =>
            section.kind === "skills" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: 简历内容只读，不会重排
              <p key={`${item.heading}-${j}`} className={styles.skillLine}>
                {skillLine(item).label && <span className={styles.heading}>{skillLine(item).label}：</span>}
                {skillLine(item).text}
              </p>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: 简历内容只读，不会重排
              <div key={`${item.heading}-${j}`} className={styles.item}>
                <div className={styles.itemHead}>
                  <span className={styles.heading}>{item.heading}</span>
                  {item.period && <span className={styles.period}>{item.period}</span>}
                </div>
                {item.subheading && <p className={styles.sub}>{item.subheading}</p>}
                {item.bullets.length > 0 && (
                  <ul className={styles.bullets}>
                    {item.bullets.map((b, k) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: 简历内容只读，不会重排
                      <li key={`${k}-${b.text.slice(0, 12)}`}>{b.text}</li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          )}
        </section>
      ))}
    </article>
  );
}
