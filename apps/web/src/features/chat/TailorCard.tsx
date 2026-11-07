import { useToast } from "../../components/Toast.tsx";
import { Button, Spinner } from "../../components/ui.tsx";
import { errorText } from "../tailor/changes.tsx";
import { useTailorActions, useTailoring } from "../tailor/queries.ts";
import styles from "./TailorCard.module.css";
import { cardStatus, changeLabel, levelName, withLiveSelection } from "./tailorCards.ts";
import type { TailorCard } from "./types.ts";

interface Props {
  card: TailorCard;
  superseded: boolean;
  onOpen: (card: TailorCard) => void;
}

const STATUS_LABEL = { draft: "草稿", adopted: "已采用", revoked: "已改回主简历" } as const;

/** 卡片状态跟当前服务端一致；更新卡已经合并进最近一次生成卡。 */
export function TailorCardView({ card, superseded, onOpen }: Props) {
  const view = useTailoring(card.jobId);
  const toast = useToast();
  const { adopt } = useTailorActions(card.jobId);
  const status = cardStatus(view.data?.tailoring, card);
  const items = withLiveSelection(card.items ?? [], view.data?.tailoring, status);
  const ids = items.filter((item) => item.selected && !item.blocked).map((item) => item.id);

  if (superseded) {
    const level = card.level ? ` · ${levelName(card.level)}` : "";
    return (
      <div className={styles.older} role="note">
        上一版{level} · {card.changes} 处改动
      </div>
    );
  }

  return (
    <section className={styles.card} data-status={status} aria-label="定制版简历">
      <div className={styles.head}>
        <strong className={styles.title}>
          {card.company} · {card.title} · 定制版
        </strong>
        <span className={styles.chip} data-status={status}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      {items.length > 0 ? (
        <ol className={styles.list}>
          {items.map((item) =>
            item.blocked ? (
              <li key={item.id} className={styles.blocked}>
                没改：{(item.violations ?? []).join("、")}（你没说过）
              </li>
            ) : (
              <li key={item.id} className={styles.item} data-off={!item.selected} title={item.summary}>
                <span className={styles.num} aria-hidden="true">
                  {item.number ?? "–"}
                </span>
                <span className={styles.itemText}>
                  <strong>{item.title}</strong>
                  {"　"}
                  {changeLabel(item)}
                </span>
              </li>
            ),
          )}
        </ol>
      ) : (
        <p className={styles.fallback}>
          共 {card.changes} 处改动{card.rejected > 0 ? `，${card.rejected} 处没改` : ""}
          ，点「在右边看」对照简历。
        </p>
      )}

      {status === "draft" && (
        <div className={styles.foot}>
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
          <Button size="sm" onClick={() => onOpen(card)}>
            在右边看
          </Button>
        </div>
      )}
    </section>
  );
}
