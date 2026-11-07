import type { TailoringView } from "./queries.ts";

export const jobDetailPath = (jobId: string) => `/jobs?job=${encodeURIComponent(jobId)}`;
export const conversationPath = (id: string) => `/c/${encodeURIComponent(id)}`;

/** 定制版优先回到生成它的对话；老数据没有对话时回岗位详情。 */
export function tailoringHref(
  tailoring: { conversationId: string | null } | null | undefined,
  jobId: string,
): string {
  return tailoring?.conversationId ? conversationPath(tailoring.conversationId) : jobDetailPath(jobId);
}

export function tailorRedirectPath(view: TailoringView | undefined, jobId: string): string {
  return tailoringHref(view?.tailoring, view?.job.id ?? jobId);
}
