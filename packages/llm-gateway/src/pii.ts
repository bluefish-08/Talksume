const PHONE = /(?<![\d\w])(?:\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const PLACEHOLDER = /\[(?:PHONE|EMAIL)_\d+\]/g;
const PARTIAL_PLACEHOLDER = /\[[A-Z_0-9]*$/;

// 这些键的值是协议标识或签名，不能被改写。
const SKIP_KEYS = new Set([
  "role",
  "type",
  "id",
  "toolCallId",
  "toolName",
  "name",
  "api",
  "provider",
  "model",
  "thinkingSignature",
  "textSignature",
  "stopReason",
  "toolsAdded",
  "toolsRemoved",
]);

export interface PiiRedactor {
  redactText(text: string): string;
  /** 递归脱敏 JSON 结构里的字符串，返回新对象。 */
  redactDeep<T>(value: T): T;
  restoreText(text: string): string;
  restoreDeep<T>(value: T): T;
  /** 流式还原：缓冲末尾可能被切断的占位符，flush 时吐出剩余内容。 */
  createStreamRestorer(): { push(delta: string): string; flush(): string };
  readonly size: number;
}

export function createPiiRedactor(): PiiRedactor {
  const byValue = new Map<string, string>();
  const byPlaceholder = new Map<string, string>();
  const counters = { PHONE: 0, EMAIL: 0 };

  function placeholderFor(kind: "PHONE" | "EMAIL", value: string): string {
    const key = `${kind}:${value}`;
    const existing = byValue.get(key);
    if (existing) return existing;
    const placeholder = `[${kind}_${++counters[kind]}]`;
    byValue.set(key, placeholder);
    byPlaceholder.set(placeholder, value);
    return placeholder;
  }

  function redactText(text: string): string {
    return text
      .replace(EMAIL, (m) => placeholderFor("EMAIL", m))
      .replace(PHONE, (m) => placeholderFor("PHONE", m));
  }

  function restoreText(text: string): string {
    return text.replace(PLACEHOLDER, (m) => byPlaceholder.get(m) ?? m);
  }

  function mapDeep<T>(value: T, fn: (s: string) => string): T {
    if (typeof value === "string") return fn(value) as T;
    if (Array.isArray(value)) return value.map((v) => mapDeep(v, fn)) as T;
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = SKIP_KEYS.has(k) ? v : mapDeep(v, fn);
      }
      return out as T;
    }
    return value;
  }

  return {
    redactText,
    restoreText,
    redactDeep: (value) => mapDeep(value, redactText),
    restoreDeep: (value) => (byPlaceholder.size === 0 ? value : mapDeep(value, restoreText)),
    createStreamRestorer() {
      let pending = "";
      return {
        push(delta) {
          const text = pending + delta;
          const cut = text.match(PARTIAL_PLACEHOLDER);
          if (cut && cut.index !== undefined) {
            pending = text.slice(cut.index);
            return restoreText(text.slice(0, cut.index));
          }
          pending = "";
          return restoreText(text);
        },
        flush() {
          const rest = pending;
          pending = "";
          return restoreText(rest);
        },
      };
    },
    get size() {
      return byPlaceholder.size;
    },
  };
}
