import { useState } from "react";
import { ApiError } from "../../api/client.ts";
import { useToast } from "../../components/Toast.tsx";
import { Button, Spinner } from "../../components/ui.tsx";
import { Modal } from "../applications/Modal.tsx";
import styles from "./PolishReview.module.css";
import { type PolishAction, type PolishEntry, usePolishActions, usePolishState } from "./polishQueries.ts";

const keyOf = (e: PolishEntry) => `${e.itemKey}#${e.sourceHash}`;

function Highlighted({ text, marks }: { text: string; marks: string[] }) {
  if (marks.length === 0) return <>{text}</>;
  const pattern = new RegExp(
    `(${marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "g",
  );
  return (
    <>
      {text.split(pattern).map((part, i) =>
        marks.includes(part) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 切分结果顺序固定
          <mark key={i} className={styles.bad}>
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

function statusOf(e: PolishEntry): { label: string; tone: string } {
  if (!e.polish) return e.stale ? { label: "原文已更新", tone: "warn" } : { label: "未润色", tone: "muted" };
  if (e.polish.status === "pending") {
    return e.polish.violations.length > 0
      ? { label: "不合格", tone: "danger" }
      : { label: "待确认", tone: "accent" };
  }
  return e.polish.accepted ? { label: "已采用", tone: "ok" } : { label: "已放弃", tone: "muted" };
}

export function PolishReview({ onClose, polishingAll }: { onClose: () => void; polishingAll: boolean }) {
  const state = usePolishState();
  const { polish, decide } = usePolishActions();
  const toast = useToast();
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());

  const entries = state.data?.entries ?? [];
  const reviewable = entries.filter(
    (e) => e.polish?.status === "pending" && e.polish.violations.length === 0,
  );
  const pending = entries.filter((e) => e.polish?.status === "pending");
  const stale = entries.filter((e) => e.stale);
  const fail = (error: unknown) =>
    toast(error instanceof ApiError ? error.message : "操作失败，请稍后再试", { tone: "error" });

  const act = (ids: string[], action: PolishAction) => {
    if (ids.length > 0) decide.mutate({ ids, action }, { onError: fail });
  };

  const repolish = (targets: PolishEntry[]) => {
    const keys = targets.map(keyOf);
    setRetrying((s) => new Set([...s, ...keys]));
    polish.mutate(
      targets.map(({ itemKey, sourceHash }) => ({ itemKey, sourceHash })),
      {
        onError: fail,
        onSettled: () => setRetrying((s) => new Set([...s].filter((k) => !keys.includes(k)))),
      },
    );
  };

  const groups = new Map<string, PolishEntry[]>();
  for (const e of entries) groups.set(e.itemKey, [...(groups.get(e.itemKey) ?? []), e]);

  return (
    <Modal
      title="润色要点"
      variant="drawer"
      wide
      onClose={onClose}
      footer={
        <>
          <Button
            size="sm"
            disabled={pending.length === 0 || decide.isPending}
            onClick={() =>
              act(
                pending.flatMap((e) => (e.polish ? [e.polish.id] : [])),
                "dismiss",
              )
            }
          >
            全部放弃
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={reviewable.length === 0 || decide.isPending}
            onClick={() =>
              act(
                reviewable.flatMap((e) => (e.polish ? [e.polish.id] : [])),
                "accept",
              )
            }
          >
            全部采用{reviewable.length > 0 ? `（${reviewable.length}）` : ""}
          </Button>
        </>
      }
    >
      <p className={styles.intro}>
        只改写表述，不新增事实：出现原文没有的数字或英文技术词的建议会标红，不能采用。采用后预览和导出都用润色后的文字。
      </p>

      {polishingAll && (
        <div className={styles.busy} role="status">
          <Spinner label="正在润色" />
          正在润色经历要点，通常需要十几秒……
        </div>
      )}

      {stale.length > 0 && !polishingAll && (
        <div className={styles.notice}>
          <span>{stale.length} 条要点的原文在对话里更新过，之前的润色已失效，先回退为原文。</span>
          <Button size="sm" disabled={polish.isPending || polishingAll} onClick={() => repolish(stale)}>
            重新润色
          </Button>
        </div>
      )}

      {state.isPending && <Spinner />}

      {[...groups.values()].map((items) => {
        const head = items[0];
        if (!head) return null;
        return (
          <section key={head.itemKey} className={styles.group}>
            <h3 className={styles.heading}>
              {head.heading}
              {head.subheading && <span className={styles.sub}>{head.subheading}</span>}
            </h3>
            <ul className={styles.list}>
              {items.map((e) => {
                const status = statusOf(e);
                const p = e.polish;
                const busy = retrying.has(keyOf(e));
                const showSuggestion = p && p.status === "pending";
                return (
                  <li key={keyOf(e)} className={styles.card} data-tone={status.tone}>
                    <div className={styles.row}>
                      <span className={styles.badge} data-tone={status.tone}>
                        {status.label}
                      </span>
                      <span className={styles.grow} />
                      {busy && <Spinner label="正在重新润色" />}
                    </div>
                    <p className={styles.source}>
                      <span className={styles.tag}>原文</span>
                      {e.text}
                    </p>
                    {p?.accepted && (
                      <p className={styles.polished}>
                        <span className={styles.tag}>{showSuggestion ? "当前" : "润色"}</span>
                        {p.accepted}
                      </p>
                    )}
                    {showSuggestion && (
                      <p className={styles.polished} data-bad={p.violations.length > 0 || undefined}>
                        <span className={styles.tag}>{p.accepted ? "新版" : "润色"}</span>
                        <Highlighted text={p.suggestion} marks={p.violations} />
                      </p>
                    )}
                    {showSuggestion && p.violations.length > 0 && (
                      <p className={styles.warn}>
                        出现了原文没有的「{p.violations.join("、")}」，不能采用，可以再改一次。
                      </p>
                    )}
                    <div className={styles.actions}>
                      {showSuggestion && (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={p.violations.length > 0 || decide.isPending}
                            onClick={() => act([p.id], "accept")}
                          >
                            采用
                          </Button>
                          <Button
                            size="sm"
                            disabled={decide.isPending}
                            onClick={() => act([p.id], "dismiss")}
                          >
                            放弃
                          </Button>
                        </>
                      )}
                      {p?.accepted && !showSuggestion && (
                        <Button size="sm" disabled={decide.isPending} onClick={() => act([p.id], "revert")}>
                          改回原文
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={polish.isPending || polishingAll}
                        onClick={() => repolish([e])}
                      >
                        {p ? "再改一次" : "润色这条"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </Modal>
  );
}
