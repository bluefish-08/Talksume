import type { TailoringView } from "./queries.ts";

/** 岗位详情「下一步」块的两种状态：还没有定制版，或已有采用的定制版。 */
export function tailorEntry(view: TailoringView | undefined) {
  const tailoring = view?.tailoring;
  const adopted = Boolean(tailoring?.adopted && tailoring.selected.length > 0);
  return {
    adopted,
    company: view?.job.company ?? "",
    conversationId: tailoring?.conversationId ?? null,
    primaryAction: adopted ? ("apply" as const) : ("tailor" as const),
  };
}
