import { type PolishTarget, ungroundedTokens } from "@talksume/core";
import { createGateway, type Gateway, GatewayConfigError, loadGatewayConfig } from "@talksume/llm-gateway";
import { z } from "zod";

export type StructuredLlm = Pick<Gateway, "completeStructured">;

export function structuredLlmFromEnv(): StructuredLlm | null {
  try {
    return createGateway(loadGatewayConfig());
  } catch (error) {
    if (error instanceof GatewayConfigError) return null;
    throw error;
  }
}

export interface PolishOutcome {
  target: PolishTarget;
  text: string;
  violations: string[];
  model: string;
}

const BATCH = 20;

const SYSTEM = `你是中文简历编辑，把求职者口语化的经历要点改写成简历风格的要点句。
规则：
1. 以动词开头（如负责、设计、实现、优化、主导、推动），去掉「我」「然后」「搞了」「弄了」等口语和语气词。
2. 突出做了什么和结果；原文有数字就保留原值并放在显眼位置。
3. 只能改写表述，严禁新增事实：数字、百分比、技术名、工具名、公司/学校/产品等专有名词，必须在该条原文或所属条目标题、副标题里出现过；原文没有量化结果就不要写任何数字，也不要加「大幅」「显著」之类无依据的程度词，不要拔高职责（如把参与写成主导、把想做写成已实现）。
4. 每条一句话，不超过 60 个汉字，不加句末标点，不拆成多条也不合并。
5. 原文信息太少时只做轻微调整，保持原意。`;

const Output = z.object({
  items: z.array(z.object({ id: z.string(), text: z.string().trim().min(1).max(200) })),
});

function groundingOf(target: PolishTarget): string {
  return [target.text, target.heading, target.subheading ?? ""].join("\n");
}

function promptOf(batch: { id: string; target: PolishTarget; note?: string }[]): string {
  const lines = batch.map(({ id, target, note }) =>
    JSON.stringify({
      id,
      所属条目: [target.heading, target.subheading].filter(Boolean).join(" · "),
      原文: target.text,
      ...(note && { 要求: note }),
    }),
  );
  return `逐条润色下面的要点，按 id 一一对应返回，不要遗漏：\n${lines.join("\n")}`;
}

async function runBatch(
  llm: StructuredLlm,
  batch: { id: string; target: PolishTarget; note?: string }[],
  temperature: number,
  signal?: AbortSignal,
): Promise<{ texts: Map<string, string>; model: string }> {
  const ids = new Set(batch.map((b) => b.id));
  const res = await llm.completeStructured({
    purpose: "polish",
    system: SYSTEM,
    prompt: promptOf(batch),
    schema: z.toJSONSchema(Output) as Record<string, unknown>,
    validate: (value) => {
      const parsed = Output.parse(value);
      const missing = [...ids].filter((id) => !parsed.items.some((item) => item.id === id));
      if (missing.length > 0) throw new Error(`缺少这些 id：${missing.join("、")}`);
      return parsed;
    },
    temperature,
    maxTokens: 120 * batch.length + 200,
    ...(signal && { signal }),
  });
  const texts = new Map<string, string>();
  for (const item of res.value.items) if (ids.has(item.id)) texts.set(item.id, item.text);
  return { texts, model: res.model };
}

/**
 * 不合格的条目带着越界词再试一次；仍不合格就原样返回违规词，由调用方标红、禁止采用。
 * previous 用于「再改一次」，提示模型换个写法。
 */
export async function polishTargetsWithLlm(
  llm: StructuredLlm,
  targets: readonly PolishTarget[],
  options: { previous?: ReadonlyMap<string, string>; signal?: AbortSignal } = {},
): Promise<PolishOutcome[]> {
  const outcomes: PolishOutcome[] = [];
  const retry = !!options.previous?.size;
  for (let start = 0; start < targets.length; start += BATCH) {
    const batch = targets.slice(start, start + BATCH).map((target, i) => {
      const prev = options.previous?.get(target.sourceHash);
      return { id: `b${i + 1}`, target, ...(prev && { note: `换一种写法，不要和这一版雷同：${prev}` }) };
    });
    const first = await runBatch(llm, batch, retry ? 0.8 : 0.2, options.signal);
    const results = batch.map(({ id, target }) => {
      const text = first.texts.get(id) ?? target.text;
      return {
        id,
        target,
        text,
        violations: ungroundedTokens(groundingOf(target), text),
        model: first.model,
      };
    });

    const failed = results.filter((r) => r.violations.length > 0);
    if (failed.length > 0) {
      const second = await runBatch(
        llm,
        failed.map(({ id, target, violations }) => ({
          id,
          target,
          note: `上一版出现了原文没有的「${violations.join("、")}」，必须删掉，只用原文里的信息`,
        })),
        0.2,
        options.signal,
      ).catch(() => undefined);
      for (const r of failed) {
        const text = second?.texts.get(r.id);
        if (!text || !second) continue;
        const violations = ungroundedTokens(groundingOf(r.target), text);
        if (violations.length < r.violations.length)
          Object.assign(r, { text, violations, model: second.model });
      }
    }
    outcomes.push(
      ...results.map(({ target, text, violations, model }) => ({ target, text, violations, model })),
    );
  }
  return outcomes;
}
