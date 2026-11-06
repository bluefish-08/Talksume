import { reportStatus, toApiError } from "./client.ts";

export interface SseMessage {
  event: string;
  data: unknown;
}

/** POST 型 SSE（EventSource 只支持 GET）。流开始前的错误按普通 JSON 抛 ApiError。 */
export async function* postSse(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  };
  if (signal) init.signal = signal;
  const res = await fetch(path, init);
  if (!res.ok || !res.body) {
    const text = await res.text();
    reportStatus(res.status, path);
    throw toApiError(res.status, text ? JSON.parse(text) : undefined);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let cut = buffer.indexOf("\n\n");
    while (cut >= 0) {
      const message = parseBlock(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
      if (message) yield message;
      cut = buffer.indexOf("\n\n");
    }
  }
}

function parseBlock(block: string): SseMessage | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return undefined;
  const raw = data.join("\n");
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: raw };
  }
}

/** GET 型 SSE，浏览器自动重连；返回取消订阅函数。 */
export function subscribeSse(path: string, handlers: Record<string, (data: unknown) => void>): () => void {
  const source = new EventSource(path);
  for (const [event, handle] of Object.entries(handlers)) {
    source.addEventListener(event, (e) => {
      const raw = (e as MessageEvent<string>).data;
      try {
        handle(JSON.parse(raw));
      } catch {
        handle(raw);
      }
    });
  }
  return () => source.close();
}
