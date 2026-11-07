import { TAILOR_LEVEL_LABELS, type TailorLevel } from "@talksume/core";
import type { TailoringView } from "../tailor/queries.ts";
import type { ChatMessage, TailorCard, TailorCardItem } from "./types.ts";

export interface PlacedTailorCard {
  card: TailorCard;
  /** 同一场对话里这个岗位后面又出了新版。 */
  superseded: boolean;
}

const isUpdate = (card: TailorCard) => card.kind === "update";

/** 更新卡（select/revoke）不单独占位，合并进它之前最近一次生成卡。 */
export function mergeTailorCard(base: TailorCard, update: TailorCard): TailorCard {
  return {
    ...base,
    ...(update.level && { level: update.level }),
    ...(update.status && { status: update.status }),
    changes: update.changes,
    rejected: update.rejected,
    ...(update.items && update.items.length > 0 ? { items: update.items } : {}),
    ...(base.kind && { kind: base.kind }),
  };
}

export function placeTailorCards(
  messages: readonly Pick<ChatMessage, "key" | "tailor">[],
): Map<string, PlacedTailorCard> {
  const latest = new Map<string, string>();
  for (const message of messages) {
    if (message.tailor && !isUpdate(message.tailor)) latest.set(message.tailor.jobId, message.key);
  }
  const placed = new Map<string, PlacedTailorCard>();
  const lastGeneration = new Map<string, string>();
  for (const message of messages) {
    const card = message.tailor;
    if (!card) continue;
    if (isUpdate(card)) {
      const key = lastGeneration.get(card.jobId);
      const entry = key ? placed.get(key) : undefined;
      if (entry) entry.card = mergeTailorCard(entry.card, card);
      continue;
    }
    placed.set(message.key, { card, superseded: latest.get(card.jobId) !== message.key });
    lastGeneration.set(card.jobId, message.key);
  }
  return placed;
}

export function levelName(level: TailorLevel | undefined): string {
  return level ? TAILOR_LEVEL_LABELS[level].name : "";
}

export type TailorStatus = "draft" | "adopted" | "revoked";

/** 卡片状态永远看服务端当前状态；服务端还没回来时，用更新卡自带的快照兜底。 */
export function cardStatus(
  tailoring: TailoringView["tailoring"] | undefined,
  card?: Pick<TailorCard, "status">,
): TailorStatus {
  if (tailoring?.adopted && tailoring.selected.length > 0) return "adopted";
  if (tailoring?.revoked) return "revoked";
  if (!tailoring && card?.status) return card.status;
  return "draft";
}

/** 选中/去掉跟随服务端；被拦下的改动永远不可选。 */
export function withLiveSelection(
  items: readonly TailorCardItem[],
  tailoring: TailoringView["tailoring"] | undefined,
  status: TailorStatus,
): TailorCardItem[] {
  if (status === "revoked") return items.map((item) => ({ ...item, selected: false }));
  if (!tailoring) return [...items];
  const chosen =
    tailoring.selected.length > 0
      ? new Set(tailoring.selected)
      : new Set(items.filter((item) => !item.blocked).map((item) => item.id));
  return items.map((item) => ({ ...item, selected: !item.blocked && chosen.has(item.id) }));
}

export const LABEL_LIMIT = 24;

export function clipLabel(text: string, limit = LABEL_LIMIT): string {
  const chars = Array.from(text.trim());
  return chars.length > limit ? `${chars.slice(0, limit - 1).join("")}…` : chars.join("");
}

function movedSkills(item: TailorCardItem): string[] {
  const order = item.order ?? [];
  const before = new Map((item.orderBefore ?? []).map((name, i) => [name, i]));
  const moved = order.filter((name, i) => (before.get(name) ?? i) > i);
  return (moved.length > 0 ? moved : order).slice(0, 2);
}

/** 从改动数据本身生成短标签，不看模型给的理由。 */
export function changeLabel(item: TailorCardItem): string {
  switch (item.kind) {
    case "summary":
      return item.hadBefore ? "改写摘要" : "补一段摘要";
    case "bullet_order":
      return clipLabel(`${item.name ?? item.order?.[0] ?? item.title}提到第一条`);
    case "bullet":
      return clipLabel(`改写「${item.name ?? item.title}」`);
    case "item_order":
      return clipLabel(`${item.name ?? item.order?.[0] ?? item.title}移到前面`);
    case "skill_order": {
      const names = movedSkills(item);
      return clipLabel(names.length > 0 ? `${names.join("、")}提前` : "技能提前");
    }
    default:
      return clipLabel(item.summary || item.title);
  }
}

export type VersionMenuItem =
  | {
      id: "main" | "tailored";
      kind: "radio";
      label: string;
      detail: string;
      checked: boolean;
    }
  | { id: "revoke"; kind: "action"; label: string; danger: boolean };

export function versionMenuItems(input: {
  company: string;
  changes: number;
  status: TailorStatus;
  showingTailored: boolean;
}): VersionMenuItem[] {
  const state = input.status === "adopted" ? "已采用" : input.status === "revoked" ? "已改回主简历" : "草稿";
  const tailored = [
    state,
    `${input.changes} 处改动`,
    ...(input.status === "adopted" ? [`投${input.company}这个岗位时用`] : []),
  ].join(" · ");
  return [
    {
      id: "main",
      kind: "radio",
      label: "主简历",
      detail: "投其他岗位时用",
      checked: !input.showingTailored,
    },
    {
      id: "tailored",
      kind: "radio",
      label: `${input.company}定制版`,
      detail: tailored,
      checked: input.showingTailored,
    },
    {
      id: "revoke",
      kind: "action",
      label: input.status === "adopted" ? "改回主简历" : "放弃草稿",
      danger: input.status === "adopted",
    },
  ];
}

export type MenuKeyAction = "close" | "next" | "prev" | "first" | "last";

export function menuKeyAction(key: string): MenuKeyAction | undefined {
  if (key === "Escape") return "close";
  if (key === "ArrowDown") return "next";
  if (key === "ArrowUp") return "prev";
  if (key === "Home") return "first";
  if (key === "End") return "last";
  return undefined;
}
