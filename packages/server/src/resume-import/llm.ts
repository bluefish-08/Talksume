import { toolJsonSchema, UpsertFactsArgs } from "@talksume/agent";
import { z } from "zod";
import type { StructuredLlm } from "../polish-llm.ts";

const SYSTEM = `你是简历解析器，把一份中文简历的原文拆成结构化的画像事实，供后续逐字核对。
规则：
1. 只提取原文明确写了的内容，不推测、不补全、不润色、不翻译；原文没有的字段就不填。
2. 每条事实的 quote 必须从原文逐字复制（标点和空格可以不同），选能支撑这条事实的那一段；依据分散在几处时用 … 连接，每段至少 4 个字。
3. 每段教育、实习/工作、项目、奖项各写一条事实，payload 带上原文里该条目的全部信息；每项技能单独一条（skills 的 name 是技能名，熟练度只在原文写了了解/熟悉/熟练/精通时填）。
4. 实习和项目的每条要点整理成一条 highlight：detail 照抄原文那一条，不改写、不合并、不加数字；title 是从这条原文里取的 4～10 字关键词。
5. 日期写成 YYYY-MM，原文只有年份就不填；「至今」写 present。学历：专科 associate、本科 bachelor、硕士 master、博士 phd；经历类型：实习 internship、全职 fulltime、兼职 parttime。
6. 基本信息放 basics：姓名、电话、邮箱、城市、个人链接、语言能力；「自我评价」「个人总结」放 summary。原文写了求职意向才填 intention。
7. 数字（GPA、排名、百分比、人数、时间）只能用原文里出现过的。`;

const Output = z.object({ facts: z.array(z.unknown()) });

/** 只要求顶层形状，逐条校验交给 verifyImportFacts，一条坏了不连累整份简历。 */
export async function parseResumeWithLlm(llm: StructuredLlm, text: string, signal?: AbortSignal) {
  const res = await llm.completeStructured({
    purpose: "resume_import",
    system: SYSTEM,
    prompt: `简历原文如下（<<< 和 >>> 之间）：\n<<<\n${text}\n>>>`,
    schema: toolJsonSchema(UpsertFactsArgs),
    validate: (value) => Output.parse(value),
    temperature: 0,
    maxTokens: 8000,
    thinking: false,
    ...(signal && { signal }),
  });
  return { facts: res.value.facts, model: res.model };
}
