import { pickDirections } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { computeCompleteness } from "./completeness.ts";
import { buildSystemPrompt, type PromptInput } from "./prompt.ts";
import { TOOL_SPECS, type ToolName } from "./schemas.ts";
import { createIntakeState } from "./types.ts";

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const state = createIntakeState();
const BASE: PromptInput = {
  profile: state.profile,
  completeness: computeCompleteness(state.profile),
  slot: null,
  completedSections: [],
  conflicts: [],
};

const CONFIGS: { name: string; input: PromptInput }[] = [
  { name: "只开建档", input: BASE },
  { name: "建档 + 岗位", input: { ...BASE, jobTools: true } },
  { name: "建档 + 岗位 + 定制", input: { ...BASE, jobTools: true, tailorTool: true } },
  { name: "建档 + 润色", input: { ...BASE, polishTool: true } },
  { name: "建档 + 样式", input: { ...BASE, styleTool: true } },
  {
    name: "建档 + 样式 + 设计 + 复刻",
    input: {
      ...BASE,
      styleTool: true,
      designTool: true,
      replica: true,
      designCandidates: pickDirections({ text: "清新", random: seeded(7) }),
    },
  },
  {
    name: "全部开启",
    input: {
      ...BASE,
      jobTools: true,
      tailorTool: true,
      polishTool: true,
      styleTool: true,
      designTool: true,
      replica: true,
      designCandidates: pickDirections({ text: "清新", random: seeded(7) }),
    },
  },
];

const INTAKE: ToolName[] = ["upsert_facts", "ask_user", "complete_section", "skip_field", "resolve_conflict"];

/** 和 controller 注册工具的条件保持一致。 */
function registered(input: PromptInput): Set<ToolName> {
  const names = new Set<ToolName>(INTAKE);
  if (input.jobTools) for (const n of ["recommend_jobs", "search_jobs", "explain_job"] as const) names.add(n);
  if (input.tailorTool)
    for (const n of ["tailor_resume", "select_tailor_changes", "revoke_tailoring"] as const) names.add(n);
  if (input.polishTool) for (const n of ["polish_resume", "decide_polish"] as const) names.add(n);
  if (input.styleTool) names.add("design_resume_style");
  if (input.designTool) names.add("propose_resume_designs");
  if (input.replica) for (const n of ["set_resume_css", "preview_resume"] as const) names.add(n);
  return names;
}

/** 每条从系统提示搬进工具说明的规则，取一句有辨识度的话。 */
const MOVED: Partial<Record<ToolName, string>> = {
  recommend_jobs: "等画像补完再推荐",
  search_jobs: "不受推荐门槛限制",
  explain_job: "不要重新搜索",
  tailor_resume: "大改」「重写」「再大胆一点",
  select_tailor_changes: "摘要那条不要",
  revoke_tailoring: "这个岗位不用定制版了",
  polish_resume: "不要让润色去编",
  decide_polish: "都用上",
  design_resume_style: "更稳重一点",
  set_resume_css: "复刻参考图时只学版式和外观",
  propose_resume_designs: "一次给用户 3 版",
  preview_resume: "每轮对话最多 3 次",
};

describe("系统提示里的工具名", () => {
  for (const config of CONFIGS) {
    it(`${config.name}：不出现未注册工具的名字`, () => {
      const prompt = buildSystemPrompt(config.input);
      const enabled = registered(config.input);
      for (const spec of TOOL_SPECS) {
        if (!enabled.has(spec.name)) expect(prompt).not.toContain(spec.name);
      }
    });

    it(`${config.name}：未注册工具的规则不在提示词里`, () => {
      const prompt = buildSystemPrompt(config.input);
      const enabled = registered(config.input);
      for (const [name, marker] of Object.entries(MOVED) as [ToolName, string][]) {
        if (!enabled.has(name)) expect(prompt).not.toContain(marker);
      }
    });
  }

  it("搬走的规则都落在对应工具说明里", () => {
    for (const [name, marker] of Object.entries(MOVED) as [ToolName, string][]) {
      const description = TOOL_SPECS.find((s) => s.name === name)?.description ?? "";
      expect(description, name).toContain(marker);
    }
  });
});
