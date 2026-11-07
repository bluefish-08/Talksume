import { TAILOR_LEVEL_LABELS, type TailorLevel } from "@talksume/core";
import type { TailoringView } from "../tailor/queries.ts";
import type { ChatMessage, TailorCard } from "./types.ts";

export interface PlacedTailorCard {
  card: TailorCard;
  /** 同一场对话里这个岗位后面又出了新版。 */
  superseded: boolean;
}

export function placeTailorCards(
  messages: readonly Pick<ChatMessage, "key" | "tailor">[],
): Map<string, PlacedTailorCard> {
  const latest = new Map<string, string>();
  for (const message of messages) {
    if (message.tailor) latest.set(message.tailor.jobId, message.key);
  }
  const placed = new Map<string, PlacedTailorCard>();
  for (const message of messages) {
    if (!message.tailor) continue;
    placed.set(message.key, {
      card: message.tailor,
      superseded: latest.get(message.tailor.jobId) !== message.key,
    });
  }
  return placed;
}

export function levelName(level: TailorLevel | undefined): string {
  return level ? TAILOR_LEVEL_LABELS[level].name : "";
}

/** 卡片上的状态永远看服务端当前是否已采用，而不是消息生成时的状态。 */
export function cardStatus(tailoring: TailoringView["tailoring"] | undefined): "draft" | "adopted" {
  return tailoring?.adopted && tailoring.selected.length > 0 ? "adopted" : "draft";
}
