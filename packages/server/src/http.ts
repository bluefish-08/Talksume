import type { FastifyReply } from "fastify";

/** 非 SSE 接口统一的错误体，见设计文档第 5 节。 */
export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  retryable = false,
) {
  return reply.code(status).send({ code, message, retryable });
}

export interface SseStream {
  send(event: string, data: unknown): void;
  /** 注释行，只为保活，防止反向代理因空闲断开。 */
  ping(): void;
  end(): void;
  readonly closed: boolean;
}

/** 接管响应并写出 SSE 头；之后由调用方负责 end。 */
export function openSse(reply: FastifyReply): SseStream {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  raw.flushHeaders();
  const writable = () => !raw.destroyed && !raw.writableEnded;
  return {
    send(event, data) {
      if (writable()) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    ping() {
      if (writable()) raw.write(": ping\n\n");
    },
    end() {
      if (writable()) raw.end();
    },
    get closed() {
      return !writable();
    },
  };
}
