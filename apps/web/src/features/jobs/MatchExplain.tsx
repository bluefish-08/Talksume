import { Spinner } from "../../components/ui.tsx";
import { useMatchExplanation } from "./hooks.ts";
import styles from "./MatchExplain.module.css";
import type { KeywordItem } from "./types.ts";

const STATUS_LABEL = { have: "已有", partial: "相近", missing: "缺失" } as const;

function Chips({ title, items }: { title: string; items: KeywordItem[] }) {
  if (items.length === 0) return null;
  const covered = items.filter((i) => i.status !== "missing").length;
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <span>{title}</span>
        <span className={styles.count}>
          覆盖 {covered}/{items.length}
        </span>
      </div>
      <ul className={styles.chips}>
        {items.map((i) => (
          <li key={i.name} className={styles.chip} data-status={i.status} title={i.source ?? i.jd}>
            <span className="sr-only">{STATUS_LABEL[i.status]}：</span>
            {i.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 纯规则的匹配解释：每一项都能指回 JD 原文或画像字段，不经过模型。 */
export function MatchExplain({ jobId }: { jobId: string }) {
  const query = useMatchExplanation(jobId);
  const e = query.data;
  if (query.isPending) {
    return (
      <p className={styles.state} role="status">
        <Spinner label="分析中" />
        正在对照 JD 关键词…
      </p>
    );
  }
  if (!e) return null;
  return (
    <section className={styles.root} aria-labelledby="explain-h">
      <header className={styles.head}>
        <h3 id="explain-h" className={styles.h3}>
          匹配解释
        </h3>
        <span className={styles.score}>
          <span className={styles.scoreNum}>{e.score}</span>
          <span className={styles.scoreLabel}>规则分</span>
        </span>
      </header>
      <ul className={styles.parts}>
        {e.components.map((c) => (
          <li key={c.key} className={styles.part} data-na={c.applicable ? undefined : true}>
            <span className={styles.partLabel}>{c.label}</span>
            <span className={styles.partNote}>{c.applicable ? c.note : "无法评估，不计入"}</span>
            <span className={styles.partValue}>
              {c.applicable ? `${c.score}（权重 ${Math.round(c.weight * 100)}%）` : "—"}
            </span>
          </li>
        ))}
      </ul>
      <Chips title="必备技能" items={e.required} />
      <Chips title="加分技能" items={e.bonus} />
      <Chips title="方向关键词" items={e.concepts} />
      <p className={styles.foot}>
        只按 JD 原文和你的简历画像比对，没有调用模型；「相近」表示你有对应的相关技能。
      </p>
    </section>
  );
}
