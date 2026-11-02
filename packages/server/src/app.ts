import type { IntakeDeps } from "@talksume/agent";
import type { Edition } from "@talksume/core";
import type { Db } from "@talksume/db";
import Fastify, { type FastifyInstance } from "fastify";
import { registerDevAuth } from "./auth.ts";
import type { ConversationSummarizer } from "./conversation-memory.ts";
import type { ConversationTitler } from "./conversation-title.ts";
import type { ConnectorRegistry } from "./flow/channels.ts";
import type { NotificationBus } from "./notifications/bus.ts";
import { conversationTitleRoutes } from "./routes/conversation-title.ts";
import { conversationRoutes } from "./routes/conversations.ts";
import { flowRoutes } from "./routes/flow.ts";
import { matchingRoutes } from "./routes/matching.ts";
import { polishRoutes } from "./routes/polish.ts";
import type { TemplateAdvisor } from "./template-advisor.ts";

export interface LlmModelOption {
  id: string;
  label: string;
  hint: string;
}

export interface LlmChoice {
  model: string;
  thinking: boolean;
}

/** 对话模型：生产由 llm-gateway 提供，测试注入假的 streamFn。models[0] 为默认模型。 */
export interface LlmDeps {
  models: LlmModelOption[];
  resolve(choice: LlmChoice): Pick<IntakeDeps, "streamFn" | "model">;
}

export interface AppDeps {
  edition: Edition;
  version: string;
  logger?: boolean;
  db?: Db;
  llm?: LlmDeps;
  /** 会话标题生成；不配时保留第一句话截断的标题。 */
  titler?: ConversationTitler;
  templateAdvisor?: TemplateAdvisor;
  /** 开新会话时给上一个会话补摘要；不传则不生成。 */
  summarizer?: ConversationSummarizer;
  flow?: { notifier?: NotificationBus; connectors?: ConnectorRegistry; sseHeartbeatMs?: number };
}

export type RouteModule = (app: FastifyInstance, deps: AppDeps & { db: Db }) => void;

const routes: RouteModule[] = [
  conversationRoutes,
  conversationTitleRoutes,
  flowRoutes,
  matchingRoutes,
  polishRoutes,
];

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
