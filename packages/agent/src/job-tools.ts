import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import type { Profile } from "@talksume/core";
import type { z } from "zod";
import {
  ExplainJobArgs,
  MAX_JOB_RESULTS,
  RecommendJobsArgs,
  SearchJobsArgs,
  TailorResumeArgs,
  type ToolName,
} from "./schemas.ts";
import { type RunContext, text, tool } from "./tools.ts";
import type { JobCard, JobTools, ResumeTailor, ToolRecord } from "./types.ts";

const JOB_TYPE_LABEL = { internship: "实习", campus: "校招", experienced: "社招" } as const;

const CARD_NOTE =
  "这些岗位会以卡片展示给用户（带匹配度和「看详情」按钮）。文字里挑一两个重点点评，不要逐条复述卡片字段；投递在岗位详情页由用户自己点按钮，官网岗位要用户在官网自己提交，你不能代投。";

const ABOUT_NOTE =
  "这个岗位会在你这条回复顶部显示为一行「关于：公司 · 岗位」标签，点开是岗位详情；本轮查到的岗位都不会以卡片展示，回复里不要提卡片或让用户点卡片。";

/** 本轮讲到具体岗位时卡片不展示，落库的工具结果也要改口，免得下一轮模型以为用户看到过卡片。 */
export function withoutCards(log: readonly ToolRecord[]): ToolRecord[] {
  return log.map((r) =>
    r.result.includes(CARD_NOTE)
      ? { ...r, result: r.result.replace(CARD_NOTE, "这些岗位只用来查找，没有以卡片展示给用户。") }
      : r,
  );
}

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

const TAILOR_NOTE =
  "定制版草稿已在右侧简历面板打开，还没有生效，面板上标着「定制版草稿 · 未采用」，改动处高亮、可逐条取消；用户在面板里点「采用」后，投递这个岗位时才会默认用定制版，主简历不变。用一两句话说明这次调整了哪些侧重，请用户在右边的简历上看一下、满意再采用；不要说已经改好、已经替换或已经生效，也不要编造上面没有的调整。";

const failedNote = (name: ToolName, reason: string) =>
  name === "tailor_resume"
    ? `定制简历失败：${reason}。如实告诉用户这次没有生成成功，可以稍后再试，或去岗位详情页点「定制简历」；绝对不要说已经改好或已经定制。`
    : `岗位服务出错：${reason}。如实告诉用户暂时查不到，可以稍后再试或去「职位推荐」页看看，不要编造岗位。`;

/** 岗位工具不写画像，出错也不计入 failures，避免触发「没听懂」的兜底追问。 */
export function createJobTools(
  ctx: RunContext,
  jobs: JobTools,
  log: ToolRecord[],
  tailor?: ResumeTailor,
): AgentTool<TSchema>[] {
  const { state } = ctx;

  async function run(name: ToolName, args: object, work: () => Promise<string>) {
    let result: string;
    try {
      result = await work();
    } catch (error) {
      result = failedNote(name, error instanceof Error ? error.message : String(error));
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
      ctx.emit({ type: "about_job", job: insight.job });
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
        "用几句口语告诉用户：整体匹配怎样、最突出的优势、最关键的差距，以及投递前可以补充或准备什么（如在画像里补上相关项目、技能）。只依据上面的内容，不要编造用户没说过的经历。",
        ABOUT_NOTE,
      );
      return lines.join("\n");
    }),
  );

  const tailorResume = tool(
    "tailor_resume",
    "定制简历",
    TailorResumeArgs,
    (args: z.infer<typeof TailorResumeArgs>) =>
      run("tailor_resume", args, async () => {
        if (!tailor) throw new Error("定制服务未开启");
        const outcome = await tailor.tailor(state.profile, state.facts, args.jobId);
        if (!outcome) {
          return `找不到 jobId=${args.jobId} 的岗位，定制没有进行。用之前岗位结果里的 jobId，或先用 search_jobs 搜到再定制；不要说已经改好。`;
        }
        const { card, lines } = outcome;
        ctx.emit({
          type: "about_job",
          job: { id: card.jobId, company: card.company, title: card.title, cities: [] },
        });
        const target = `${card.company} · ${card.title}`;
        const blocked =
          card.rejected > 0 ? `另有 ${card.rejected} 处因出现简历里没有的内容被拦下，不会采用。` : "";
        if (card.changes === 0) {
          return `针对「${target}」没有得到可采用的调整，简历维持原样。${blocked}如实告诉用户现在的简历和这个岗位已经比较贴合，或者可以先补充相关经历；不要说已经改好。${ABOUT_NOTE}`;
        }
        ctx.emit({ type: "tailor", tailor: card });
        return [
          `已为「${target}」生成定制版草稿，共 ${card.changes} 处调整：`,
          ...lines,
          blocked,
          TAILOR_NOTE,
          ABOUT_NOTE,
        ]
          .filter(Boolean)
          .join("\n");
      }),
  );

  return [recommendJobs, searchJobs, explainJob, ...(tailor ? [tailorResume] : [])];
}
