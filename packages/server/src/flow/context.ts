import { ApplicationRepo, type Db } from "@talksume/db";
import type { FastifyBaseLogger } from "fastify";
import type { NotificationBus } from "../notifications/bus.ts";
import type { ConnectorRegistry } from "./channels.ts";

export interface FlowContext {
  db: Db;
  repo: ApplicationRepo;
  notifier: NotificationBus;
  connectors: ConnectorRegistry;
  sseHeartbeatMs: number;
  log: FastifyBaseLogger;
}

export function createFlowContext(input: Omit<FlowContext, "repo">): FlowContext {
  return { ...input, repo: new ApplicationRepo(input.db) };
}
