import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import type { Profile } from "@talksume/core";
import type { z } from "zod";
import {
  ExplainJobArgs,
  MAX_JOB_RESULTS,
  RecommendJobsArgs,
  SearchJobsArgs,
  type ToolName,
} from "./schemas.ts";
import { type RunContext, text, tool } from "./tools.ts";
import type { JobCard, JobTools, ToolRecord } from "./types.ts";

const JOB_TYPE_LABEL = { internship: "实习", campus: "校招", experienced: "社招" } as const;

const CARD_NOTE =
  "这些岗位已以卡片展示给用户（带匹配度和「看详情」「去投递」按钮）。文字里挑一两个重点点评，不要逐条复述卡片字段；投递要用户自己点按钮确认，你不能代投。";

export function describeCard(card: JobCard, index?: number): string {
  const parts = [
    `jobId=${card.id}`,
    `${card.company} · ${card.title}`,
    card.cities.slice(0, 3).join("/"),
    card.jobType && JOB_TYPE_LABEL[card.jobType],
    card.score !== undefined && `匹配度 ${Math.round(card.score)}`,
    card.reason && `理由：${card.reason}`,
  ].filter(Boolean);
  return `${index === undefined ? "" : `${index + 1}. `}${parts.join("｜")}`;
}

function profileGapNote(profile: Profile): string | undefined {
  const gaps = [
    ...(profile.intention.roles.length === 0 ? ["求职意向"] : []),
    ...(profile.skills.length === 0 ? ["技能"] : []),
  ];
  if (gaps.length === 0) return undefined;
  return `画像里还没有${gaps.join("和")}，结果只能作参考：先把结果告诉用户，再用 ask_user 顺带问一句${gaps[0]}。`;
}

const clampLimit = (n: number | undefined) => Math.min(MAX_JOB_RESULTS, Math.max(1, n ?? 3));

const plain = (args: object) => JSON.parse(JSON.stringify(args)) as Record<string, unknown>;

/** 岗位工具不写画像，出错也不计入 failures，避免触发「没听懂」的兜底追问。 */
export function createJobTools(ctx: RunContext, jobs: JobTools, log: ToolRecord[]): AgentTool<TSchema>[] {
  const { state } = ctx;

  async function run(name: ToolName, args: object, work: () => Promise<string>) {
    let result: string;
    try {
      result = await work();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result = `岗位服务出错：${reason}。如实告诉用户暂时查不到，可以稍后再试或去「职位推荐」页看看，不要编造岗位。`;
    }
    ctx.flags.jobs = true;
    log.push({ name, args: plain(args), result });
    return text(result);
  }

  const recommendJobs = tool(
    "recommend_jobs",
    "推荐岗位",
    RecommendJobsArgs,
    (args: z.infer<typeof RecommendJobsArgs>) =>
      run("recommend_jobs", args, async () => {
        const { limit: _limit, ...filters } = args;
        const r = await jobs.recommend(state.profile, { ...filters, limit: clampLimit(args.limit) });
        const lines: string[] = [];
        if (r.jobs.length === 0) {
          lines.push(`没有找到合适的推荐岗位。${r.hint ?? ""}`.trim());
          lines.push("如实告诉用户，可以建议放宽条件，或用 search_jobs 直接搜索某类岗位。");
        } else {
          ctx.emit({ type: "jobs", source: "recommend", jobs: r.jobs });
          lines.push(`推荐列表共 ${r.total} 个岗位，按条件取前 ${r.jobs.length} 个：`);
          lines.push(...r.jobs.map(describeCard));
          if (r.hint) lines.push(r.hint);
          lines.push(CARD_NOTE);
        }
        const gap = profileGapNote(state.profile);
        if (gap) lines.push(gap);
        return lines.join("\n");
      }),
  );

  const searchJobs = tool("search_jobs", "搜索岗位", SearchJobsArgs, (args: z.infer<typeof SearchJobsArgs>) =>
    run("search_jobs", args, async () => {
      const { limit: _limit, ...query } = args;
      const r = await jobs.search(state.profile, { ...query, limit: clampLimit(args.limit) });
      if (r.jobs.length === 0) {
        return "全部在招岗位里没有搜到。可以换个说法再搜一次（如「后端」换成「后台」、去掉城市限制），仍然没有就如实告诉用户。";
      }
      ctx.emit({ type: "jobs", source: "search", jobs: r.jobs });
      return [
        `在全部在招岗位里共搜到 ${r.total} 个，取前 ${r.jobs.length} 个（匹配度按用户当前画像估算）：`,
        ...r.jobs.map(describeCard),
        CARD_NOTE,
      ].join("\n");
    }),
  );

  const explainJob = tool("explain_job", "解读岗位", ExplainJobArgs, (args: z.infer<typeof ExplainJobArgs>) =>
    run("explain_job", args, async () => {
      const insight = await jobs.explain(state.profile, args.jobId);
      if (!insight) {
        return `找不到 jobId=${args.jobId} 的岗位。用之前岗位结果里的 jobId，或先用 search_jobs 搜到再解读。`;
      }
      const card = { ...insight.job, ...(insight.summary && { reason: insight.summary }) };
      ctx.emit({ type: "jobs", source: "explain", jobs: [card] });
      const lines = [describeCard(insight.job)];
      if (insight.summary) lines.push(`总结：${insight.summary}`);
      if (insight.strengths.length > 0) lines.push("优势：", ...insight.strengths.map((s) => `- ${s}`));
      if (insight.gaps.length > 0) lines.push("短板：", ...insight.gaps.map((s) => `- ${s}`));
      lines.push(
        "各维度（0–100）：",
        ...insight.dims.map((d) => `- ${d.label} ${d.score}${d.evidence[0] ? `：${d.evidence[0]}` : ""}`),
      );
      if (insight.blocked) lines.push(`硬性条件不符：${insight.blocked}`);
      lines.push(
        "用几句口语告诉用户：整体匹配怎样、最突出的优势、最关键的差距，以及投递前可以补充或准备什么（如在画像里补上相关项目、技能）。只依据上面的内容，不要编造用户没说过的经历。岗位卡片已展示给用户。",
      );
      return lines.join("\n");
    }),
  );

  return [recommendJobs, searchJobs, explainJob];
}
