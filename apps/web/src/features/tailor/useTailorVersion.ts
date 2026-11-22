import { useToast } from "../../components/Toast.tsx";
import { cardStatus } from "../chat/tailorCards.ts";
import { errorText } from "./changes.tsx";
import { useTailorActions, useTailoring } from "./queries.ts";
import { selectedChanges, useExcluded } from "./selection.ts";

/** 版本下拉和「用这版」共用的数据与动作；对话面板和简历页头部都走这里。 */
export function useTailorVersion(jobId: string | undefined, onRevoked: () => void) {
  const toast = useToast();
  const { adopt, revoke } = useTailorActions(jobId ?? "");
  const view = useTailoring(jobId).data?.tailoring;
  const { off } = useExcluded(jobId ?? "", view?.updatedAt);
  const status = cardStatus(view);
  const chosen = view ? selectedChanges(view, off).map((c) => c.id) : [];
  return {
    status,
    changes: chosen.length,
    chosen,
    busy: adopt.isPending || revoke.isPending,
    adopting: adopt.isPending,
    onAdopt: () =>
      adopt.mutate(chosen, {
        onSuccess: () => toast("已采用定制版，投递这个岗位时会默认使用", { tone: "success" }),
        onError: (e) => toast(errorText(e), { tone: "error" }),
      }),
    onRevoke: () =>
      revoke.mutate(undefined, {
        onSuccess: () => {
          onRevoked();
          toast("已改回主简历，投递这个岗位时不再用定制版");
        },
        onError: (e) => toast(errorText(e), { tone: "error" }),
      }),
  };
}
