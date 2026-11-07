import { useToast } from "../../components/Toast.tsx";
import { Button, Spinner } from "../../components/ui.tsx";
import { errorText } from "../tailor/changes.tsx";
import { useTailorActions, useTailoring } from "../tailor/queries.ts";
import styles from "./TailorCard.module.css";
import { cardStatus, levelName } from "./tailorCards.ts";
import type { TailorCard } from "./types.ts";

interface Props {
  card: TailorCard;
  superseded: boolean;
  onOpen: (card: TailorCard) => void;
}

/** 卡片状态跟当前服务端一致；历史消息里的卡片只保留当时的改动清单。 */
export function TailorCardView({ card, superseded, onOpen }: Props) {
  const view = useTailoring(card.jobId);
  const toast = useToast();
  const { adopt } = useTailorActions(card.jobId);
  const adopted = cardStatus(view.data?.tailoring) === "adopted";
  const level = levelName(card.level);
  const items = card.items ?? [];
  const ids = items.filter((item) => item.selected && !item.blocked).map((item) => item.id);

  if (superseded) {
    return (
      <div className={styles.older} role="note">
        <span>
          上一版{level ? ` · ${level}` : ""} · {card.changes} 处改动
        </span>
        <span className={styles.grow} />
        <span>已被下面这版替换</span>
      </div>
    );
  }

  return (
    <section className={styles.card} data-adopted={adopted} aria-label="定制版简历">
      <div className={styles.head}>
        <span className={styles.avatar} aria-hidden="true">
          {card.company.slice(0, 1)}
        </span>
        <div className={styles.headText}>
          <strong className={styles.title}>
            {card.company} · {card.title}定制版
          </strong>
          <span className={styles.meta}>只用于这个岗位{level ? ` · ${level}` : ""}</span>
        </div>
        <span className={styles.chip} data-adopted={adopted}>
          {adopted ? "已采用" : "草稿"}
        </span>
      </div>

      {items.length > 0 ? (
        <ol className={styles.list}>
          {items.map((item) => (
            <li
              key={item.id}
              className={styles.item}
              data-blocked={item.blocked}
              data-off={!item.blocked && !item.selected}
            >
              <span className={styles.num} data-blocked={item.blocked} aria-hidden="true">
                {item.number ?? "–"}
              </span>
              <span>
                <strong>{item.title}</strong>
                {item.blocked ? (
                  <>
                    {"　"}没改：{item.summary}
                    {item.violations && item.violations.length > 0
                      ? `（${item.violations.join("、")} 你没说过）`
                      : "（你没说过）"}
                  </>
                ) : (
                  <>
                    {"　"}
                    {item.summary}
                    {!item.selected && <span className={styles.off}> · 已去掉</span>}
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.fallback}>
          共 {card.changes} 处改动{card.rejected > 0 ? `，${card.rejected} 处没改` : ""}
          ，点「在右边逐条看」对照简历。
        </p>
      )}

      <div className={styles.foot}>
        {!adopted && (
          <Button
            variant="dark"
            size="sm"
            disabled={adopt.isPending || ids.length === 0}
            onClick={() =>
              adopt.mutate(ids, {
                onSuccess: () => toast("已采用这版定制简历", { tone: "success" }),
                onError: (error) => toast(errorText(error), { tone: "error" }),
              })
            }
          >
            {adopt.isPending && <Spinner label="采用中" />}用这版
          </Button>
        )}
        <Button size="sm" onClick={() => onOpen(card)}>
          在右边逐条看
        </Button>
        <span className={styles.grow} />
        <span className={styles.hint}>{adopted ? "想撤回就说「改回主简历」" : "不满意直接说"}</span>
      </div>
    </section>
  );
}
