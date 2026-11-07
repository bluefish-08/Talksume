import type { PolishEntry } from "../resume/polishQueries.ts";
import type { ChatMessage, PolishCard, PolishCardItem } from "./types.ts";

export interface PlacedPolishCard {
  card: PolishCard;
  /** 同一场对话里后面又生成了新的一版。 */
  superseded: boolean;
}

const isUpdate = (card: PolishCard) => card.kind === "update";

/** 更新卡（decide）不单独占位，合并进最近一次生成卡。 */
export function mergePolishCard(base: PolishCard, update: PolishCard): PolishCard {
  return {
    ...base,
    ...(update.status && { status: update.status }),
    ...(update.items && update.items.length > 0 ? { items: update.items } : {}),
    ...(base.kind && { kind: base.kind }),
  };
}

export function placePolishCards(
  messages: readonly Pick<ChatMessage, "key" | "polish">[],
): Map<string, PlacedPolishCard> {
  const latest = messages.findLast((m) => m.polish && !isUpdate(m.polish))?.key;
  const placed = new Map<string, PlacedPolishCard>();
  let lastGeneration: string | undefined;
  for (const message of messages) {
    const card = message.polish;
    if (!card) continue;
    if (isUpdate(card)) {
      const entry = lastGeneration ? placed.get(lastGeneration) : undefined;
      if (entry) entry.card = mergePolishCard(entry.card, card);
      continue;
    }
    placed.set(message.key, { card, superseded: latest !== message.key });
    lastGeneration = message.key;
  }
  return placed;
}

export function polishStatus(items: readonly PolishCardItem[]): "draft" | "adopted" | "partial" | "none" {
  const accepted = items.some((item) => !item.blocked && item.state === "accepted");
  if (accepted) return items.some((item) => item.state === "pending") ? "partial" : "adopted";
  const live = items.filter((item) => !item.blocked);
  return live.length > 0 && live.every((item) => item.state === "dismissed") ? "none" : "draft";
}

/** 卡片行跟随服务端当前条目；被拦下的建议永远不可采用。 */
export function withLivePolishItems(
  items: readonly PolishCardItem[],
  entries: readonly PolishEntry[] | undefined,
): PolishCardItem[] {
  if (!entries) return [...items];
  const byId = new Map(entries.flatMap((entry) => (entry.polish ? [[entry.polish.id, entry] as const] : [])));
  return items.map((item) => {
    const entry = byId.get(item.id);
    const polish = entry?.polish;
    if (!entry || !polish) return item;
    return {
      ...item,
      heading: entry.heading,
      before: entry.text,
      after: polish.status === "accepted" ? (polish.accepted ?? polish.suggestion) : polish.suggestion,
      state: polish.status,
      blocked: polish.violations.length > 0,
      ...(polish.violations.length > 0 && { violations: polish.violations }),
    };
  });
}

export function pendingPolishIds(items: readonly PolishCardItem[]): string[] {
  return items.filter((item) => item.state === "pending" && !item.blocked).map((item) => item.id);
}

export function clipPolish(text: string, limit: number): string {
  const chars = Array.from(text.trim());
  return chars.length > limit ? `${chars.slice(0, limit).join("")}…` : chars.join("");
}
