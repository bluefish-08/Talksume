import type { Channel } from "./types.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  if (diff < MIN) return "刚刚";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export const CHANNEL_LABELS: Record<Channel, string> = {
  hr_workspace: "站内投递",
  assisted: "官网投递",
  platform_api: "平台直投",
};

export const cityText = (cities: string[]) => cities.slice(0, 2).join("、");

export const JOB_TYPE_LABELS: Record<string, string> = {
  internship: "实习",
  campus: "校招",
  experienced: "社招",
};
