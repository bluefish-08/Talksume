import type { IntakeDeps, TurnMetrics } from "@talksume/agent";
import type { Edition } from "@talksume/core";
import type { Db } from "@talksume/db";
import type { MatchingServiceOptions } from "@talksume/matching";
import Fastify, { type FastifyInstance } from "fastify";
import type { ConversationSummarizer } from "./conversation-memory.ts";
import type { ConversationTitler } from "./conversation-title.ts";
import type { ConnectorRegistry } from "./flow/channels.ts";
import { devHeaderIdentity, type IdentityProvider, installIdentity, localUserIdentity } from "./identity.ts";
import type { NotificationBus } from "./notifications/bus.ts";
import { type StructuredLlm, structuredLlmFromEnv } from "./polish-llm.ts";
import { conversationTitleRoutes } from "./routes/conversation-title.ts";
import { conversationRoutes } from "./routes/conversations.ts";
import { flowRoutes } from "./routes/flow.ts";
import { interviewRoutes } from "./routes/interview.ts";
import { jobsBrowseRoutes } from "./routes/jobs-browse.ts";
import { matchingRoutes } from "./routes/matching.ts";
import { polishRoutes } from "./routes/polish.ts";
import { tailorRoutes } from "./routes/tailor.ts";
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

export type TurnReport = TurnMetrics & { conversationId: string; model?: string };

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
  /** 对话里岗位工具用的匹配服务参数；不传按环境变量。 */
  matching?: MatchingServiceOptions;
  /** 按岗位定制简历用的结构化输出模型；null 显式关闭，不传按环境变量。 */
  resumeLlm?: StructuredLlm | null;
  /** 每轮对话的耗时，同时写进请求日志。 */
  onTurnMetrics?: (metrics: TurnReport) => void;
  /** 身份来源；不传时本地版是固定的本机用户，TALKSUME_DEV_AUTH=1 用开发身份，cloud 版必须注入。 */
  identity?: IdentityProvider;
  /** 反向代理层数，用来从 X-Forwarded-For 取真实 IP；不经代理时不要设。 */
  trustProxy?: number;
  flow?: { notifier?: NotificationBus; connectors?: ConnectorRegistry; sseHeartbeatMs?: number };
}

export type RouteModule = (app: FastifyInstance, deps: AppDeps & { db: Db; devAuth?: boolean }) => void;

const routes: RouteModule[] = [
  conversationRoutes,
  conversationTitleRoutes,
  flowRoutes,
  interviewRoutes,
  jobsBrowseRoutes,
  matchingRoutes,
  polishRoutes,
  tailorRoutes,
];

function defaultIdentity(edition: Edition, db: Db): IdentityProvider {
  if (process.env.TALKSUME_DEV_AUTH === "1") return devHeaderIdentity(db);
  if (edition === "cloud") throw new Error("cloud 版必须通过 deps.identity 注入身份来源");
  return localUserIdentity(db);
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? false,
    ...(deps.trustProxy !== undefined && {
      trustProxy: (_addr: string, hop: number) => hop < (deps.trustProxy ?? 0),
    }),
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/api/v1/meta", async () => ({
    name: "talksume",
    edition: deps.edition,
    version: deps.version,
  }));

  const { db } = deps;
  if (db) {
    const identity = deps.identity ?? defaultIdentity(deps.edition, db);
    installIdentity(app, identity, db);
    const resumeLlm = deps.resumeLlm === undefined ? structuredLlmFromEnv() : deps.resumeLlm;
    for (const register of routes) register(app, { ...deps, db, resumeLlm, devAuth: identity.dev === true });
  }

  return app;
}
