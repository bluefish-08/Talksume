import type { RouteModule } from "../app.ts";
import { ConnectorRegistry } from "../flow/channels.ts";
import { createFlowContext } from "../flow/context.ts";
import { installErrorHandler } from "../flow/http.ts";
import { InProcessNotifier } from "../notifications/bus.ts";
import { registerApplicationRoutes } from "./applications.ts";
import { registerDevRoutes } from "./dev.ts";
import { registerHrRoutes } from "./hr.ts";
import { registerNotificationRoutes } from "./notifications.ts";

/** 投递流程：候选人投递、HR 工作台、通知（含 SSE）。 */
export const flowRoutes: RouteModule = (app, deps) => {
  app.register(async (scope) => {
    installErrorHandler(scope);
    const ctx = createFlowContext({
      db: deps.db,
      notifier: deps.flow?.notifier ?? new InProcessNotifier(),
      connectors: deps.flow?.connectors ?? new ConnectorRegistry(),
      sseHeartbeatMs: deps.flow?.sseHeartbeatMs ?? 25_000,
      log: scope.log,
    });
    registerApplicationRoutes(scope, ctx);
    registerHrRoutes(scope, ctx);
    registerNotificationRoutes(scope, ctx);
    if (process.env.NODE_ENV !== "production") registerDevRoutes(scope, ctx);
  });
};
