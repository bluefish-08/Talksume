import {
  Award,
  Basics,
  CSS_LIMITS,
  describeCssVocabulary,
  Education,
  Experience,
  HexColor,
  Intention,
  PROFILE_SECTIONS,
  type ProfileSection,
  Project,
  ResumeTheme,
  Skill,
  TAILOR_LEVELS,
  THEME_ALIGNS,
  THEME_BULLETS,
  THEME_DENSITIES,
  THEME_FONTS,
  THEME_HEADERS,
  THEME_HEADINGS,
  THEME_LAYOUTS,
  THEME_SKELETONS,
  THEME_SKILLS,
} from "@talksume/core";
import { z } from "zod";

const OMIT_IDS = { id: true, sourceFactIds: true } as const;

export const HighlightInput = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .describe("4～10 字的关键词短语，概括这条要点，如「订单查询重构」「缓存一致性」"),
  detail: z
    .string()
    .trim()
    .min(1)
    .describe(
      "简历写法的一句话：去掉「我」和口语，动词开头、精炼；事实、技术、数字只用用户说过的，不拔高角色，系统会校验，不合格退回原话",
    ),
});

const TechStack = z.array(z.string()).describe("这段经历用到的技术、框架、工具，一项一条");
const Highlights = z
  .array(HighlightInput)
  .describe("经历要点：用户讲的职责、难点与做法、结果，各整理成一条；补充已有要点时沿用原 title");

/** 事实 payload 的校验 schema：条目分区只强制要求能定位条目的键，其余字段可分批补充。 */
export const SectionPayload = {
  basics: Basics.omit({ headline: true, photo: true }),
  education: Education.omit(OMIT_IDS).partial().required({ school: true }),
  experiences: Experience.omit(OMIT_IDS)
    .partial()
    .required({ company: true })
    .extend({ techStack: TechStack.optional(), highlights: Highlights.optional() }),
  projects: Project.omit(OMIT_IDS)
    .partial()
    .required({ name: true })
    .extend({ techStack: TechStack.optional(), highlights: Highlights.optional() }),
  skills: Skill.omit(OMIT_IDS),
  awards: Award.omit(OMIT_IDS),
  intention: Intention.partial(),
} as const satisfies Record<ProfileSection, z.ZodType>;

const Quote = z
  .string()
  .trim()
  .min(1)
  .describe("用户原话片段，逐字摘抄不要改写；依据分散在不相邻的几处时，各段用 … 连接，每段至少两个字");

function factVariant<S extends ProfileSection>(section: S) {
  return z.object({
    section: z.literal(section),
    payload: SectionPayload[section],
    quote: Quote,
  });
}

export const FactInput = z.discriminatedUnion("section", [
  factVariant("basics"),
  factVariant("education"),
  factVariant("experiences"),
  factVariant("projects"),
  factVariant("skills"),
  factVariant("awards"),
  factVariant("intention"),
]);
export type FactInput = z.infer<typeof FactInput>;

export const UpsertFactsArgs = z.object({
  facts: z.array(FactInput).min(1).describe("一句话包含多个事实时批量写入；每条事实只含用户明确说过的信息"),
});
export type UpsertFactsArgs = z.infer<typeof UpsertFactsArgs>;

export const AskUserArgs = z.object({
  question: z.string().trim().min(1).describe("向用户提出的一个具体问题，口语化、一次只问一件事"),
  quickReplies: z
    .array(z.string())
    .optional()
    .describe(
      "2 到 4 条用户可一键发送的简短回答（每条 12 字以内，第一人称），如「是独立完成的」「跳过这个」；只给用户确实可能这样回答的选项，不确定就省略",
    ),
});
export type AskUserArgs = z.infer<typeof AskUserArgs>;

export const MAX_QUICK_REPLIES = 4;
export const MAX_QUICK_REPLY_LENGTH = 20;

/** 去空、去重、截断；不足 2 条视为模型没给。 */
export function cleanQuickReplies(raw: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const item of raw ?? []) {
    const text = item.trim();
    if (text && text.length <= MAX_QUICK_REPLY_LENGTH) seen.add(text);
  }
  const list = [...seen].slice(0, MAX_QUICK_REPLIES);
  return list.length >= 2 ? list : [];
}

export const CompleteSectionArgs = z.object({
  section: z.enum(PROFILE_SECTIONS),
  reason: z
    .enum(["done", "user_skipped"])
    .default("done")
    .describe("done=该分区信息已足够；user_skipped=用户明确表示没有或不想提供"),
  quote: z.string().optional().describe("reason 为 user_skipped 时必填：用户表示没有/不想提供的原话"),
});
export type CompleteSectionArgs = z.infer<typeof CompleteSectionArgs>;

export const SkipFieldArgs = z.object({
  key: z
    .string()
    .optional()
    .describe("要跳过的字段 key，见「当前目标字段」或 upsert_facts 返回的下一个目标；不传则跳过当前目标字段"),
  quote: Quote.describe("用户表示没有/不想说的原话，如「GPA 不想说」「没有个人网站」"),
});
export type SkipFieldArgs = z.infer<typeof SkipFieldArgs>;

export const ResolveConflictArgs = z.object({
  factId: z.string().optional().describe("待确认矛盾的 factId，见系统提示里的矛盾列表"),
  field: z.string().optional().describe("没有 factId 时用矛盾所在字段名定位，如 situation"),
  choice: z.enum(["proposed", "previous"]).describe("proposed=采用新说法；previous=保留原来的"),
  quote: Quote.describe("用户表示选哪个的原话，如「用原来的」「新的对」"),
});
export type ResolveConflictArgs = z.infer<typeof ResolveConflictArgs>;

export const MAX_JOB_RESULTS = 5;

const JobTypeArg = z
  .enum(["internship", "campus", "experienced"])
  .optional()
  .describe("internship=实习，campus=校招，experienced=社招；用户没提就不传");
const JobLimit = z.number().int().optional().describe(`返回几个，默认 3，最多 ${MAX_JOB_RESULTS}`);

export const RecommendJobsArgs = z.object({
  city: z.string().trim().optional().describe("只看某个城市时传，如「上海」"),
  jobType: JobTypeArg,
  keyword: z.string().trim().optional().describe("岗位方向关键词，如「后端」「算法」；用户没限定方向就不传"),
  limit: JobLimit,
});
export type RecommendJobsArgs = z.infer<typeof RecommendJobsArgs>;

export const SearchJobsArgs = z.object({
  query: z.string().trim().min(1).describe("岗位关键词，如「后台开发」「数据分析」，不要把公司名写进来"),
  company: z.string().trim().optional().describe("公司名，如「腾讯」"),
  city: z.string().trim().optional(),
  jobType: JobTypeArg,
  limit: JobLimit,
});
export type SearchJobsArgs = z.infer<typeof SearchJobsArgs>;

export const ExplainJobArgs = z.object({
  jobId: z.string().trim().min(1).describe("岗位 id，取自之前 recommend_jobs / search_jobs 返回的 jobId"),
});
export type ExplainJobArgs = z.infer<typeof ExplainJobArgs>;

export const TailorResumeArgs = z.object({
  jobId: z
    .string()
    .trim()
    .min(1)
    .describe("岗位 id，取自之前 recommend_jobs / search_jobs / explain_job 返回的 jobId"),
  level: z
    .enum(TAILOR_LEVELS)
    .optional()
    .describe(
      "定制档位：light 微调（默认，只调顺序和措辞）；keywords 嵌入关键词（把已有技能换成岗位的说法）；deep 深度改写（重写措辞）。用户没明确说就不要填。",
    ),
});
export type TailorResumeArgs = z.infer<typeof TailorResumeArgs>;

export const SelectTailorChangesArgs = z.object({
  jobId: z.string().trim().min(1).describe("岗位 id，取自之前 tailor_resume 的 jobId"),
  keep: z
    .array(z.string().trim().min(1))
    .optional()
    .describe("要保留的改动 id；用户说「只留摘要和技能」时，传这些 id，其余取消"),
  drop: z
    .array(z.string().trim().min(1))
    .optional()
    .describe("要去掉的改动 id；用户说「摘要那条不要」时传对应 id"),
  adopt: z.boolean().optional().describe("用户说「用这版」「就按这个来」时填 true，立即采用选中的改动"),
});
export type SelectTailorChangesArgs = z.infer<typeof SelectTailorChangesArgs>;

export const RevokeTailoringArgs = z.object({
  jobId: z.string().trim().min(1).describe("岗位 id，取自之前 tailor_resume 的 jobId"),
});
export type RevokeTailoringArgs = z.infer<typeof RevokeTailoringArgs>;

export const PolishResumeArgs = z.object({
  items: z
    .array(z.string().trim().min(1))
    .optional()
    .describe(
      "要点所在的条目标题，用简历上显示的名字（如「云图数据」「校园二手交易平台」）；不填则润色所有还没有建议的要点",
    ),
  instruction: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .optional()
    .describe("风格要求，如「更专业」「突出数据」「精简一点」；只影响措辞，不能新增事实"),
});
export type PolishResumeArgs = z.infer<typeof PolishResumeArgs>;

export const DecidePolishArgs = z.object({
  accept: z.array(z.string().trim().min(1)).optional().describe("要采用的润色 id"),
  dismiss: z.array(z.string().trim().min(1)).optional().describe("不要的润色 id"),
  revert: z.array(z.string().trim().min(1)).optional().describe("要改回原文的润色 id"),
  all: z
    .enum(["accept", "dismiss", "revert"])
    .optional()
    .describe("对卡片里所有待定建议（accept/dismiss）或所有已采用建议（revert）操作"),
});
export type DecidePolishArgs = z.infer<typeof DecidePolishArgs>;

export const DesignResumeStyleArgs = z.object({
  name: z.string().trim().min(1).max(12).optional().describe("这套样式的短名字，如「稳重深绿」「清爽蓝」"),
  accent: HexColor.optional().describe(
    "主色 #rrggbb，用于标题、线条、色块。用户说的颜色换成具体色值，如深绿 #166534、藏青 #1e3a5f、酒红 #9f1239、墨黑 #1f2937",
  ),
  headingColor: HexColor.optional().describe("分区标题文字色；用户单独指定标题颜色且和主色不同时才填"),
  bodyFont: z
    .enum(THEME_FONTS)
    .optional()
    .describe("正文字体：sans 黑体（现代清爽），serif 宋体（传统稳重）"),
  headingFont: z
    .enum(THEME_FONTS)
    .optional()
    .describe("姓名和分区标题字体：sans 黑体，serif 宋体（稳重、正式）"),
  header: z
    .enum(THEME_HEADERS)
    .optional()
    .describe("抬头：plain 无装饰，rule 底部细线，band 主色色块白字（醒目活泼）"),
  headerAlign: z.enum(THEME_ALIGNS).optional().describe("抬头对齐：left 左对齐，center 居中"),
  headingStyle: z
    .enum(THEME_HEADINGS)
    .optional()
    .describe(
      "分区标题：underline 下划线（经典），bar 左侧色条（现代），block 色块白字（醒目），plain 只变色（极简）",
    ),
  layout: z
    .enum(THEME_LAYOUTS)
    .optional()
    .describe("single 单栏（网申系统读取最稳），sidebar 两栏（左栏放教育、技能、奖项）"),
  skeleton: z
    .enum(THEME_SKELETONS)
    .optional()
    .describe(
      "页面骨架（决定整页结构，比 layout 优先）：classic 经典单栏；side-left 左侧深色通栏侧栏、抬头在侧栏里；side-right 右侧浅色通栏侧栏；band-cols 通栏色块抬头 + 正文/侧栏两栏；timeline 时间线；cards 灰底白卡片；numbered 01/02 编号标题。选了骨架后 header/headingStyle 不再生效，颜色和字体仍按主题",
    ),
  bullet: z.enum(THEME_BULLETS).optional().describe("项目符号：dot 圆点，square 方块，dash 短横"),
  skills: z.enum(THEME_SKILLS).optional().describe("技能展示：line 文字行，tags 标签"),
  density: z
    .enum(THEME_DENSITIES)
    .optional()
    .describe("疏密：auto 自动排满一页，roomy 宽松，normal 标准，compact 紧凑（内容多、想压到一页）"),
  reset: z.boolean().optional().describe("用户要回到原来的预设模板时填 true，其他字段都不填"),
});
export type DesignResumeStyleArgs = z.infer<typeof DesignResumeStyleArgs>;

export const SetResumeCssArgs = z.object({
  css: z
    .string()
    .max(CSS_LIMITS.maxChars + 2000)
    .optional()
    .describe("完整的一份 CSS，会替换上一份定制 CSS；只写白名单里的类、属性和素材名"),
  clear: z.boolean().optional().describe("要去掉定制 CSS、只保留主题时填 true，css 不填"),
});
export type SetResumeCssArgs = z.infer<typeof SetResumeCssArgs>;

export const ProposeDesignsArgs = z.object({
  designs: z
    .array(
      z.object({
        direction: z
          .string()
          .max(40)
          .optional()
          .describe("方向库里的方向 id（只从系统提示里本轮候选方向挑）；填了它就不用再给 theme 和 css"),
        accent: HexColor.optional().describe("想换主色时才填（用方向时），不填就用方向自带的配色"),
        summary: z
          .string()
          .min(2)
          .max(40)
          .optional()
          .describe("一句话说清这版的气质；用方向时可省略，自己设计时必填"),
        theme: ResumeTheme.optional().describe(
          "不用方向、自己设计时给这一版的完整主题（所有字段都要填；name 是这版的名字，不超过 12 个字）",
        ),
        css: z
          .string()
          .max(CSS_LIMITS.maxChars + 2000)
          .optional()
          .describe("可选的定制 CSS，用来加装饰（几何形状、编号、渐变），写法同 set_resume_css"),
      }),
    )
    .length(3)
    .describe(
      "恰好 3 版，页面骨架互不相同（方向的骨架或 theme.skeleton，同一组里不能有两版同骨架），配色、字体气质也要明显不同",
    ),
});
export type ProposeDesignsArgs = z.infer<typeof ProposeDesignsArgs>;

export const PreviewResumeArgs = z.object({});

export type ToolName =
  | "upsert_facts"
  | "ask_user"
  | "complete_section"
  | "skip_field"
  | "resolve_conflict"
  | "recommend_jobs"
  | "search_jobs"
  | "explain_job"
  | "tailor_resume"
  | "select_tailor_changes"
  | "revoke_tailoring"
  | "polish_resume"
  | "decide_polish"
  | "design_resume_style"
  | "set_resume_css"
  | "preview_resume"
  | "propose_resume_designs";

export const JOB_TOOL_NAMES: readonly ToolName[] = [
  "recommend_jobs",
  "search_jobs",
  "explain_job",
  "tailor_resume",
  "select_tailor_changes",
  "revoke_tailoring",
];

export interface ToolSpec {
  name: ToolName;
  description: string;
  schema: z.ZodType;
}

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "upsert_facts",
    description:
      "把用户在对话中明确说出的信息写入画像；用户说完一段话就调用，一句话含多个事实时一次写入。每条事实必须附带 quote（用户原话，逐字摘抄）；只写用户说过的内容，不要推测、补全或美化。叙述性字段（项目的 situation、获奖的 description、basics.summary、要点的 detail）补充时写包含原文的完整合并文本，只有用户明确纠正时才替换。实习和项目统一写 highlights，不要写 bullets/task/action/result；项目背景写 situation。教育：gpa 照用户说的原样写，排名写 rank，课程一门一条；奖学金、竞赛奖项写 awards，三好学生、优秀毕业生这类荣誉称号写 education.honors。basics.links 每项 {label, url}。技术栈只写对应条目的 techStack；skills 只记用户这句话里亲口说的技能，不要从已有条目的技术栈里搬过去。",
    schema: UpsertFactsArgs,
  },
  {
    name: "ask_user",
    description:
      "向用户追问下一个问题，可附带 quickReplies 作为用户的快捷回答；question 填你刚在正文里问的那句。调用后本轮对话结束，等待用户回答。每轮最多调用一次，只在「下一个目标」有内容时调用。问技术栈时给这类方向常见的组合（如「Java + MySQL」「Go」）再加「跳过这个」；问量化结果时给「没有具体数字」「记不清了」。",
    schema: AskUserArgs,
  },
  {
    name: "complete_section",
    description:
      "标记某个分区已收集完成，或用户明确表示该分区没有内容。reason=done 表示信息已够，user_skipped 表示用户明确说没有或不想提供（要带 quote）。",
    schema: CompleteSectionArgs,
  },
  {
    name: "skip_field",
    description:
      "用户对某一项明确说没有或不想说时调用（如「成绩不想说」）；上一轮问的那一项用户只回「没有」「没统计过」「记不清」「没遇到难点」也算，直接调用，不要再追问。只能跳过上一轮问的那一项；闲聊或没有信息的消息不要调用。跳过的项以后的会话都不会再问；整个分区都没有时改用 complete_section。",
    schema: SkipFieldArgs,
  },
  {
    name: "resolve_conflict",
    description:
      "用户用文字回答了待确认的矛盾（如「用原来的」「保留之前的」「新的对」「以刚才说的为准」）时调用，choice=previous 保留原来的、proposed 采用新的，quote 摘抄用户这句原话；用户没明确选哪个时不要调用。调用后按返回的「下一个目标」接着问，不要在文字里复述或再次追问矛盾。",
    schema: ResolveConflictArgs,
  },
  {
    name: "recommend_jobs",
    description:
      "按用户画像取推荐岗位（已按匹配度排序），可按城市、求职类型、方向关键词收窄。用户让你推荐岗位、问「我适合什么」时调用；直接调用，不要推说「等画像补完再推荐」，画像缺求职意向或技能也先给结果。",
    schema: RecommendJobsArgs,
  },
  {
    name: "search_jobs",
    description:
      "在全部在招岗位里搜索，不受推荐门槛限制。用户问某家公司、某个具体岗位时调用：公司名放 company，岗位关键词放 query。",
    schema: SearchJobsArgs,
  },
  {
    name: "explain_job",
    description:
      "解读用户和某个岗位的匹配情况：匹配度、优势、短板和投递前可以补充什么。用户问「我差在哪」「这个岗位怎么样」「第二个呢」时调用；jobId 取自之前的岗位结果，用户说「第二个」「刚才那个腾讯的」时也从之前结果里找，不要重新搜索，找不到再用 search_jobs。",
    schema: ExplainJobArgs,
  },
  {
    name: "tailor_resume",
    description:
      "针对某个岗位生成一份定制版简历草稿：只调整要点顺序、措辞侧重、技能展示顺序和一句摘要，不新增任何事实，主简历不变。用户说「帮我针对这个岗位改一下简历」「让简历更适配那个岗位」「定制一下」时调用，jobId 取自之前的岗位结果，找不到先用 search_jobs。有三档：微调（默认，不用填 level）、嵌入关键词（用户说「用岗位的说法」「把关键词写进去」→ keywords）、深度改写（用户说「大改」「重写」「再大胆一点」→ deep）；用户没提档位就不要填，也不要追问。草稿会在右侧简历面板打开，要用户在面板里采用后才生效。用户想加简历里没有的内容（如岗位要的某项技能）时补不上：先如实说明，再问有没有相关经历，有就先用 upsert_facts 记下，之后再定制。",
    schema: TailorResumeArgs,
  },
  {
    name: "select_tailor_changes",
    description:
      "按用户的话勾选或去掉当前定制版草稿里的改动，可在同一轮直接采用。用户说「摘要那条不要」「只留技能那条」「用这版」时调用。keep 和 drop 用 tailor_resume 卡片或工具结果里的改动 id；被拦下的改动不能选，找不到的 id 不要硬编。",
    schema: SelectTailorChangesArgs,
  },
  {
    name: "revoke_tailoring",
    description:
      "把某个岗位改回主简历（撤销已采用的定制版）。用户说「改回主简历」「这个岗位不用定制版了」时调用。",
    schema: RevokeTailoringArgs,
  },
  {
    name: "polish_resume",
    description:
      "润色简历里的经历要点：只改写措辞，不新增事实，出现原文没有的数字或英文词的建议会被拦下。用户说「润色一下」「写得更专业/更有力」「把某段改得好一点」时调用；点名了条目就填 items（用简历上的条目标题），说了风格就把「更专业」「突出数据」「精简一点」这类填进 instruction。用户想加内容（新技能、新结果）先用 upsert_facts，不要让润色去编。结果会以卡片展示，用户在卡片或右侧预览里采用后才生效；最后可以提醒用户点「润色」。",
    schema: PolishResumeArgs,
  },
  {
    name: "decide_polish",
    description:
      "按用户的话采用、放弃或改回润色建议。用户说「都用上」用 all=accept，「第2条不要」用 dismiss 传对应 id，「改回去」「还是原来的好」用 revert。id 取自润色卡片或上一次工具结果；被拦下（出现原文没有的内容）的建议永远不能采用。",
    schema: DecidePolishArgs,
  },
  {
    name: "design_resume_style",
    description:
      "按用户对简历外观的要求定制简历样式（配色、字体、抬头和分区标题样式、单栏或两栏、疏密），只改外观不改内容，预览和导出的 PDF 都会按它来。用户说「更稳重一点」「标题换成深绿」「做成两栏」「排紧凑点」「换个风格」时调用；这些话不要用 upsert_facts 记。只填用户这次要改的字段，其余沿用当前样式；颜色给具体色值，太浅的颜色系统会自动加深。模糊说法这样翻译：「稳重/正式」→ 标题用 serif、underline 或 plain 标题、深色主色；「活泼/现代」→ band 抬头、bar 标题；「简洁」→ plain 抬头和标题；「紧凑/压到一页」→ compact。用户要回到原来的模板时填 reset=true。",
    schema: DesignResumeStyleArgs,
  },
  {
    name: "set_resume_css",
    description: `复刻参考图时只学版式和外观（配色、抬头结构、分区标题样式、图标、分隔线、字体气质、单栏还是两栏），图里的姓名、公司、经历、文字一律不要照搬，也不要用 upsert_facts 记；颜色用系统附在消息里的色值，不要凭眼睛估。流程：先用 design_resume_style 定下主色、单双栏、抬头、标题样式这些基础，再用本工具补主题表达不了的装饰，然后调用 preview_resume 对照参考图检查。照片位 .photo 默认不显示，只有参考图里有证件照时才用 asset(photo-placeholder) 占位显示。用受限的 CSS 复刻参考图里主题字段表达不了的外观（渐变和色块、图标、分隔线、照片位、字体、精细的间距和标题样式）。CSS 只作用于简历的固定结构，写进去的内容必须落在下面的白名单里，写错的规则（没有的类、不支持的属性或值）会被整条丢弃并逐条告诉你，其余照常保存；夹带 url()、@规则等试探写法则整份都不保存（上一版继续有效）；选择器会自动限定在简历内部，不要写 body、html、* 或 @规则，禁止 url()、@import、@font-face、伪元素以外的地方写 transform / clip-path、content 里写任意文字（伪元素的 content 只能是 ""、01–12 编号或少量符号）、!important、filter、list-style-type；要点符号用 li::before 自己画（background 或 mask 配 asset 素材），不要用 ::marker；mask 不加 -webkit- 前缀也行。每次传完整的一份，会替换上一份。简历文字、条目顺序都由系统渲染，CSS 改不了也不能隐藏。\n结构（页面骨架不同，外层容器也不同：side-left/side-right 是 .frame>(.side 含抬头 + .main)，band-cols 是 header 后接 .frame>(.main + .side)，timeline/cards/numbered 是 header 后接 .frame 包住全部分区）：header.head（.photo 照片位、.head-main 里 h1 姓名和 .headline 求职意向、.contacts 里每个 span 联系方式、.summary 摘要）→ section[data-kind] 里 h2 分区标题 + .sec-body 里的 .item（.item-head 里 .item-title .item-sub 和 .item-aside 里的 .item-period .item-meta；.item-stack；ul>li 要点，li 里 .lead .num）或 .skill-line（.item-title .lvl .tags>.tag）；两栏时 .cols 里是 .side 和 .main。\n${describeCssVocabulary()}`,
    schema: SetResumeCssArgs,
  },
  {
    name: "propose_resume_designs",
    description:
      "一次给用户 3 版明显不同的简历设计，让用户在缩略图里点选，选中后才保存。用户说了风格词（清新、高级极简、设计感、理工风、活泼……）、说「帮我设计一下/换个好看的/来几个版式」或者没提具体要求只想要更好看时调用；用户只要改某一处（换成深绿、标题加粗）时仍用 design_resume_style。优先用系统提示里的「本轮候选方向」：每版只填 direction（三版骨架互不相同、字体/抬头/标题样式也要拉开），方向自带完整的版式手法和配色；只有候选都不合用户要求时，才自己填 theme（和可选 css）。三版里至少一版要适合投大厂网申：用经典骨架或不依赖左右分栏的骨架；分栏骨架介绍时提醒用户 ATS 可能读乱。工具会逐版校验和渲染，返回三张缩略图和自检结果；有被拒绝或自检不过的版本，按原因修好重新提交（最多再调一次）。调用后用两三句话介绍三版各自的气质，请用户点选，不要说已经应用了。",
    schema: ProposeDesignsArgs,
  },
  {
    name: "preview_resume",
    description:
      "把当前保存的样式套在用户的简历上渲染成一张整页图片返回给你，用来和参考图对比。每轮对话最多 3 次；调用前先把这一轮要改的样式保存好。返回里还有版式自检（页数、溢出、重叠）。",
    schema: PreviewResumeArgs,
  },
];

export function toolJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: "input", target: "draft-7" }) as Record<
    string,
    unknown
  >;
  return rest;
}

export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
