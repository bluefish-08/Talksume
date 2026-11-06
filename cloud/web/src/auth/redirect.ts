/** 只接受站内路径，防止登录后被带去外站。 */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/^\/(login|register|forgot-password|reset-password|verify-email)(\/|\?|$)/.test(value)) return fallback;
  return value;
}

export function withNext(path: string, next: string): string {
  return next === "/" ? path : `${path}?next=${encodeURIComponent(next)}`;
}
