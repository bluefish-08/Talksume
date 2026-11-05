import { ungroundedTokens } from "@talksume/core";

// 分句开头的「我」都删；「我们」只在紧跟动作时删，「我们组」「我的」「我校」保留
const SUBJECT_VERBS =
  "负责|参与|主要|自己|一起|当时|后来|还|也|就|先|又|把|在|和|跟|帮|给|对|用|做|写|学|搭|设计|实现|开发|完成|整理|组织|碰到|遇到|发现|解决|改|加|调|测|部署|维护|处理|带|提|是";

const LEADING_TIME =
  /^(?:(?:大|研|高)[一二三四](?:[上下]学期)?|[上下]学期|去年|今年|前年|\d{2,4}年(?:\d{1,2}月)?|[春夏秋冬]季|寒假|暑假)+(?:的时候|期间)?[，,\s]*/u;
const LEADING_PLACE = /^在([^，,。；;]{2,12}?)(?:[，,\s]+|(?=参加|参与|做|负责|帮))/u;

/** 退回的原话常以「大一在计算机协会，参加过…」开头：时间归时间段，组织已在标题里，「参加过」统一成「参与」。 */
function stripLead(text: string, heading: string): string {
  let out = text.replace(LEADING_TIME, "");
  const place = out.match(LEADING_PLACE);
  if (place?.[1] && heading.replace(/\s+/g, "").includes(place[1].replace(/\s+/g, ""))) {
    out = out.slice(place[0].length);
  }
  return out.replace(/^(?:参加|参与)过(?:一次|几次)?/u, "参与");
}

/** 去掉分句开头的「我」「我们」、开头的时间地点和句末标点；只删不加，不会引入新事实。 */
export function tidyWording(text: string, heading = ""): string {
  const plain = text
    .trim()
    .replace(
      new RegExp(`(^|[，。；;,、！!？?\\s])(?:我们(?=${SUBJECT_VERBS})|我(?![们的校司院方]))`, "gu"),
      "$1",
    )
    .replace(/^[，。；;,、\s]+/u, "");
  return stripLead(plain, heading).replace(/[，。；;,.！!\s]+$/u, "");
}

/** 原话没说就不能出现的程度词和职责词，补在 core 拔高词检查之外。 */
const CLAIMS: [RegExp, RegExp][] = [
  [/负责/, /负责/],
  [/提升|提高/, /提升|提高/],
  [/优化/, /优化/],
  [/显著|大幅|极大/, /显著|大幅|极大/],
  [/高效|高性能|高并发|高可用/, /高效|高性能|高并发|高可用/],
  [/核心/, /核心/],
  [/精通|熟练|擅长/, /精通|熟练|擅长/],
  [/架构/, /架构/],
];

// 简历常用的连接词和动词，不算新增内容
const STYLE_WORDS =
  /负责|参与|基于|使用|采用|利用|通过|实现|完成|开发|设计|编写|搭建|整理|进行|处理|协助|组织|排查|定位|解决|统一|相关|以及|模块|功能|界面|数据|问题|活动|系统|工作|一次|分别|共同|其中|[并及与将为的了和对等把在中用于]/gu;

// 实测同义改写（清灰→清理灰尘）≥0.55，凭空加功能 ≤0.43
const MIN_CONTENT_COVERAGE = 0.5;

const plain = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");

function bigrams(text: string): Set<string> {
  const flat = plain(text);
  const out = new Set<string>();
  for (let i = 0; i < flat.length - 1; i++) out.add(flat.slice(i, i + 2));
  return out;
}

function contentCoverage(text: string, grounds: Set<string>): number {
  const grams = text
    .toLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .flatMap((clause) => clause.split(STYLE_WORDS))
    .flatMap((fragment) => [...bigrams(fragment)]);
  if (grams.length === 0) return 1;
  return grams.filter((g) => grounds.has(g)).length / grams.length;
}

/**
 * 改写里原话找不到出处的数字、英文词、拔高说法；内容大半不在原话里时报「原话之外的内容」。
 * label 用于标题和角色这类短语：只查 core 的拔高词、数字和英文词。
 */
export function wordingProblems(text: string, source: string, label = false): string[] {
  const flat = plain(source);
  // source 可能是去掉标点的用户语料：英文词连写、小数点丢失时按连写形式再找一次
  const problems = new Set(
    ungroundedTokens(source, text).filter((token) =>
      /^\d/.test(token)
        ? !(token.includes(".") && flat.includes(token.replace(/[.,]/g, "")))
        : !flat.includes(plain(token)),
    ),
  );
  if (label) return [...problems];
  for (const [claim, support] of CLAIMS) {
    const hit = text.match(claim);
    if (hit && !support.test(source)) problems.add(hit[0]);
  }
  if (/我/.test(text)) problems.add("我");
  if (contentCoverage(text, bigrams(source)) < MIN_CONTENT_COVERAGE) problems.add("原话之外的内容");
  return [...problems];
}

export interface Worded {
  text: string;
  /** 非空表示改写不合格、已退回原话。 */
  problems: string[];
}

/** 模型写的简历用语过了校验就用，否则退回原话（同样去掉开头的「我」）。 */
export function resumeWording(written: string, fallback: string, source: string, heading = ""): Worded {
  const text = tidyWording(written, heading);
  const problems = wordingProblems(text, source);
  return problems.length === 0 ? { text, problems } : { text: tidyWording(fallback, heading), problems };
}
