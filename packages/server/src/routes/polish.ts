import { profileToResume } from "@talksume/core";
import { z } from "zod";
import type { RouteModule } from "../app.ts";
import { loadProfile } from "../conversation-store.ts";
import { sendError } from "../http.ts";
import { polishTargetsWithLlm, type StructuredLlm } from "../polish-llm.ts";
import {
  decidePolishes,
  loadPolishRows,
  polishEntries,
  savePolishOutcomes,
  splitPolishOutcomes,
} from "../polish-store.ts";
import { polishBusyFor } from "../polish-tools.ts";

const PolishBody = z
  .object({
    /** 不传则润色所有还没有建议的要点；传了就对这些要点「再改一次」。 */
    targets: z
      .array(z.object({ itemKey: z.string(), sourceHash: z.string() }))
      .max(50)
      .optional(),
  })
  .default({});

const DecisionBody = z.object({
  ids: z.array(z.string()).min(1).max(200),
  action: z.enum(["accept", "dismiss", "revert"]),
});

/** 传 llm 为 null 显式关闭；不传则用应用配置的结构化模型。 */
export function createPolishRoutes(
  options: { llm?: StructuredLlm | null; busy?: Set<string> } = {},
): RouteModule {
  return (app, deps) => {
    const { db } = deps;
    const llm = options.llm === undefined ? (deps.resumeLlm ?? null) : options.llm;
    const busy = options.busy ?? deps.polishBusy ?? polishBusyFor(db);

    const snapshot = async (userId: string) => {
      const [{ profile }, rows] = await Promise.all([loadProfile(db, userId), loadPolishRows(db, userId)]);
      return { available: !!llm, entries: polishEntries(profileToResume(profile), rows) };
    };

    app.get("/api/v1/resume/polish", (req) => snapshot(req.userId));

    app.post("/api/v1/resume/polish", async (req, reply) => {
      if (!llm) return sendError(reply, 503, "llm_unavailable", "还没有配置模型，暂时不能润色");
      const parsed = PolishBody.safeParse(req.body ?? {});
      if (!parsed.success) return sendError(reply, 400, "invalid_request", "请求格式不对");
      if (busy.has(req.userId)) return sendError(reply, 409, "polish_busy", "上一次润色还没完成", true);

      const { entries } = await snapshot(req.userId);
      const wanted = parsed.data.targets;
      const picked = wanted
        ? entries.filter((e) => wanted.some((w) => w.itemKey === e.itemKey && w.sourceHash === e.sourceHash))
        : entries.filter((e) => !e.polish);
      if (picked.length === 0) return snapshot(req.userId);

      const previous = new Map(
        wanted ? picked.flatMap((e) => (e.polish ? [[e.sourceHash, e.polish.suggestion] as const] : [])) : [],
      );
      busy.add(req.userId);
      try {
        const outcomes = await polishTargetsWithLlm(llm, picked, { previous });
        await savePolishOutcomes(db, req.userId, splitPolishOutcomes(outcomes).changed);
      } catch (error) {
        req.log.error({ err: error }, "resume polish failed");
        return sendError(reply, 503, "polish_failed", "润色暂时失败，请稍后重试", true);
      } finally {
        busy.delete(req.userId);
      }
      return snapshot(req.userId);
    });

    app.post("/api/v1/resume/polish/decisions", async (req, reply) => {
      const parsed = DecisionBody.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 400, "invalid_request", "请求格式不对");
      const result = await decidePolishes(db, req.userId, parsed.data.ids, parsed.data.action);
      return { ...result, ...(await snapshot(req.userId)) };
    });
  };
}

export const polishRoutes: RouteModule = (app, deps) => createPolishRoutes()(app, deps);
