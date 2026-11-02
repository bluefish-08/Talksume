import { InvalidTransitionError } from "@talksume/core";
import { ApplicationNotFoundError, ConcurrentTransitionError } from "@talksume/db";
import type { FastifyInstance } from "fastify";
import type { z } from "zod";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(404, "not_found", "资源不存在");
  return value;
}

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new HttpError(400, "invalid_request", message);
  }
  return result.data;
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    const send = (status: number, code: string, message: string) =>
      reply.status(status).send({ error: code, message });
    if (err instanceof HttpError) return send(err.status, err.code, err.message);
    if (err instanceof InvalidTransitionError) return send(409, "invalid_transition", err.message);
    if (err instanceof ConcurrentTransitionError) return send(409, "concurrent_modification", err.message);
    if (err instanceof ApplicationNotFoundError) return send(404, "not_found", err.message);
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return send(status, "bad_request", (err as Error).message);
    }
    req.log.error(err);
    return send(500, "internal_error", "服务器内部错误");
  });
}

export function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) => (e as { code?: string } | null | undefined)?.code;
  return code(err) === "23505" || code((err as { cause?: unknown } | null)?.cause) === "23505";
}
