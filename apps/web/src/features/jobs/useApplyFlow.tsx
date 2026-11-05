import { useState } from "react";
import { ApiError } from "../../api/client.ts";
import { useToast } from "../../components/Toast.tsx";
import { ApplyDialog, type ManualApply } from "./ApplyDialog.tsx";
import { useAppliedJobs, useCreateApplication } from "./hooks.ts";
import type { JobSummary } from "./types.ts";

/** 只有 HR 端发布的岗位能在站内真的投出去，其余岗位要用户到官网提交。 */
export const isOfficialJob = (job: Pick<JobSummary, "source">) => job.source !== "hr_workspace";

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "出了点问题，请稍后再试");

export function useApplyFlow(job: JobSummary | undefined) {
  const toast = useToast();
  const applied = useAppliedJobs().data;
  const createApp = useCreateApplication();
  const [manual, setManual] = useState<ManualApply | null>(null);
  const application = job ? applied?.get(job.id) : undefined;

  function apply() {
    if (!job) return;
    const target = { company: job.company, title: job.title, url: job.url };
    if (application?.status === "pending") {
      setManual({ applicationId: application.id, ...target });
      return;
    }
    // 要在点击的同一个调用栈里开新标签，等请求返回再开会被浏览器拦截
    const opened = isOfficialJob(job) && !!job.url;
    if (opened && job.url) window.open(job.url, "_blank", "noopener,noreferrer");
    createApp.mutate(job.id, {
      onSuccess: (r) => {
        if (r.nextAction === "manual_apply") {
          setManual({
            applicationId: r.application.id,
            ...target,
            opened,
            ...(r.submitError && { submitError: r.submitError }),
          });
        } else {
          toast("已投递，进度会出现在「投递进度」里", { tone: "success" });
        }
      },
      onError: (e) => {
        const dup = e instanceof ApiError && e.code === "already_applied";
        toast(dup ? "已经投递过这个岗位了" : errorText(e), { tone: dup ? "info" : "error" });
      },
    });
  }

  const dialog = manual && (
    <ApplyDialog
      apply={manual}
      onClose={() => setManual(null)}
      onApplied={() => {
        setManual(null);
        toast("已标记为已在官网投递，进度可以在「投递进度」里看", { tone: "success" });
      }}
    />
  );
  return { apply, application, applying: createApp.isPending, dialog };
}
