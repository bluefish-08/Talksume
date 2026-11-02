import type { Edition } from "@talksume/core";
import Fastify, { type FastifyInstance } from "fastify";

export interface AppDeps {
  edition: Edition;
  version: string;
  logger?: boolean;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/api/v1/meta", async () => ({
    name: "talksume",
    edition: deps.edition,
    version: deps.version,
  }));

  return app;
}
