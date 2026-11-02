import type { Edition } from "@talksume/core";
import type { Db } from "@talksume/db";
import Fastify, { type FastifyInstance } from "fastify";
import { registerDevAuth } from "./auth.ts";

export interface AppDeps {
  edition: Edition;
  version: string;
  logger?: boolean;
  db?: Db;
}

export type RouteModule = (app: FastifyInstance, deps: AppDeps & { db: Db }) => void;

const routes: RouteModule[] = [];

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
