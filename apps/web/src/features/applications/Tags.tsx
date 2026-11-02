import { type ApplicationOutcome, type ApplicationStatus, statusLabel } from "@talksume/core";
import { CHANNEL_LABELS } from "./format.ts";
import styles from "./Tags.module.css";
import type { Channel } from "./types.ts";

function toneOf(status: ApplicationStatus, outcome: ApplicationOutcome | null): string | undefined {
  if (status === "closed") return outcome === "offer" ? styles.success : styles.muted;
  if (status === "interviewing") return styles.warning;
  if (status === "pending") return styles.neutral;
  return styles.accent;
}

/** 文字永远带着，颜色只是辅助。 */
export function StatusTag({
  status,
  outcome = null,
}: {
  status: ApplicationStatus;
  outcome?: ApplicationOutcome | null;
}) {
  return (
    <span className={[styles.tag, toneOf(status, outcome)].join(" ")}>{statusLabel(status, outcome)}</span>
  );
}

export function ChannelTag({ channel }: { channel: Channel }) {
  return <span className={[styles.tag, styles.outline].join(" ")}>{CHANNEL_LABELS[channel]}</span>;
}
