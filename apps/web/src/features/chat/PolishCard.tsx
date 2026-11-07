import { Check } from "lucide-react";
import { ApiError } from "../../api/client.ts";
import { useToast } from "../../components/Toast.tsx";
import { Button, Spinner } from "../../components/ui.tsx";
import { usePolishActions, usePolishState } from "../resume/polishQueries.ts";
import styles from "./PolishCard.module.css";
import { clipPolish, pendingPolishIds, polishStatus, withLivePolishItems } from "./polishCards.ts";
import type { PolishCard } from "./types.ts";

interface Props {
  card: PolishCard;
  superseded: boolean;
  onOpen?: ((card: PolishCard) => void) | undefined;
}

const STATUS_LABEL = { draft: "草稿", adopted: "已采用", partial: "部分采用", none: "没采用" } as const;

/** 「都用上」只提交待定且没被拦下的建议。 */
export function acceptAllDecision(items: readonly { id: string; state: string; blocked: boolean }[]) {
  return {
    ids: items.filter((item) => item.state === "pending" && !item.blocked).map((item) => item.id),
    action: "accept" as const,
  };
}

export function PolishCardView({ card, superseded, onOpen }: Props) {
  const state = usePolishState();
  const { decide } = usePolishActions();
  const toast = useToast();
  const items = withLivePolishItems(card.items, state.data?.entries);
  const status = polishStatus(items);
  const pending = pendingPolishIds(items);
  const count = items.filter((item) => !item.blocked).length;

  if (superseded) {
    return (
      <div className={styles.older} role="note">
        上一版润色 · {count} 处建议
      </div>
    );
  }

  return (
    <section className={styles.card} data-status={status} aria-label="润色建议">
      <div className={styles.head}>
        <strong className={styles.title}>润色 · {count} 处</strong>
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
              <li key={item.id} className={styles.item} data-state={item.state}>
                <span className={styles.num} aria-hidden="true">
                  {item.number ?? "–"}
                </span>
                <span className={styles.itemText}>
                  <strong>{item.heading}</strong>
                  {"　"}改写「{clipPolish(item.before, 12)}」
                </span>
                {item.state === "accepted" && (
                  <span className={styles.state} data-state="accepted">
                    <Check size={12} strokeWidth={2.4} aria-hidden="true" />
                    已采用
                  </span>
                )}
                {item.state === "dismissed" && (
                  <>
                    <span className={styles.state} data-state="dismissed">
                      不要
                    </span>
                    <span className={styles.after} data-state="dismissed">
                      {clipPolish(item.after, 20)}
                    </span>
                  </>
                )}
              </li>
            ),
          )}
        </ol>
      ) : (
        <p className={styles.fallback}>还没有润色建议。</p>
      )}

      <div className={styles.foot}>
        {pending.length > 0 && (
          <Button
            variant="dark"
            size="sm"
            disabled={decide.isPending}
            onClick={() =>
              decide.mutate(acceptAllDecision(items), {
                onSuccess: () => toast("已采用这些润色", { tone: "success" }),
                onError: (error) =>
                  toast(error instanceof ApiError ? error.message : "操作失败，请稍后再试", {
                    tone: "error",
                  }),
              })
            }
          >
            {decide.isPending && <Spinner label="采用中" />}都用上
          </Button>
        )}
        {onOpen && (
          <Button size="sm" onClick={() => onOpen(card)}>
            在右边看
          </Button>
        )}
      </div>
    </section>
  );
}
