import type { IntakeDeps } from "@talksume/agent";
import type { Edition } from "@talksume/core";
import type { Db } from "@talksume/db";
import Fastify, { type FastifyInstance } from "fastify";
import { registerDevAuth } from "./auth.ts";
import type { ConnectorRegistry } from "./flow/channels.ts";
import type { NotificationBus } from "./notifications/bus.ts";
import { conversationRoutes } from "./routes/conversations.ts";
import { flowRoutes } from "./routes/flow.ts";

/** 对话模型：生产由 llm-gateway 提供，测试注入假的 streamFn。 */
export type LlmDeps = Pick<IntakeDeps, "streamFn" | "model">;

export interface AppDeps {
  edition: Edition;
  version: string;
  logger?: boolean;
  db?: Db;
  llm?: LlmDeps;
  flow?: { notifier?: NotificationBus; connectors?: ConnectorRegistry; sseHeartbeatMs?: number };
}

export type RouteModule = (app: FastifyInstance, deps: AppDeps & { db: Db }) => void;

const routes: RouteModule[] = [conversationRoutes, flowRoutes];

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/api/v1/meta", async () => ({
    name: "talksume",
    edition: deps.edition,
    version: deps.version,
  }));

  const { db } = deps;
  if (db) {
    registerDevAuth(app, db);
    for (const register of routes) register(app, { ...deps, db });
  }

  return app;
}
