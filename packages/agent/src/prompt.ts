import type { DesignDirection, Profile, ProfileSection } from "@talksume/core";
import { type Completeness, SECTION_BY_NAME, type Slot } from "./completeness.ts";
import { type Conflict, type Draft, draftMissing, isPlaceholderDraft } from "./facts.ts";
import { memoryPromptLines, type SkipEntry, type SummaryNote } from "./memory.ts";

export interface PromptInput {
  profile: Profile;
  completeness: Completeness;
  slot: Slot | null;
  completedSections: readonly ProfileSection[];
  conflicts: readonly Conflict[];
  drafts?: readonly Draft[];
  skipped?: readonly SkipEntry[];
  /** 已经收尾：这一轮不再提问。 */
  closed?: boolean;
  /** 本轮用户这句话已被系统直接记为跳过的字段。 */
  autoSkipped?: SkipEntry;
  summaries?: readonly SummaryNote[];
  /** 是否开放岗位推荐、搜索与解读工具。 */
  jobTools?: boolean;
  /** 是否开放按岗位定制简历，依赖岗位工具。 */
  tailorTool?: boolean;
  /** 是否开放对话润色简历。 */
  polishTool?: boolean;
  /** 是否开放对话定制简历样式。 */
  styleTool?: boolean;
  designTool?: boolean;
  designCandidates?: readonly DesignDirection[];
  /** 开放定制 CSS 和预览（有参考图，或之前用过）。 */
  replica?: boolean;
  /** 这一条用户消息带了图片。 */
  hasImage?: boolean;
}

function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== "id" && k !== "sourceFactIds")
        .map(([k, v]) => [k, stripIds(v)]),
    );
  }
  return value;
}

export const RESUME_HINT = "右侧预览就是简历，可以点「润色」优化表述、切换模板，或者直接导出。";

/** 收尾指令：thin 为简历还比较单薄。 */
export function wrapGuide(thin: boolean): string {
  return thin
    ? `先用一句话回应用户，再用两三句话（不要列清单）总结，如实说明还缺什么，总结只写一次，告诉用户简历页有「投递前可以补的东西」，并告诉用户：${RESUME_HINT}`
    : `先用一句话回应用户，再用两三句话（不要列清单）总结已经收集的信息，总结只写一次，并告诉用户：${RESUME_HINT}`;
}

export function describeSlot(slot: Slot): string {
  const where = slot.itemLabel ? `「${slot.itemLabel}」的` : "";
  const area = slot.kind === "probe" ? "挖掘经历" : SECTION_BY_NAME[slot.section].label;
  const lines = [`目标：${area} → ${where}${slot.label}（key=${slot.key}）`, `参考问法：${slot.question}`];
  if (slot.strategy) lines.push(`追问策略：${slot.strategy}`);
  if (slot.replies) lines.push(`快捷回答参考：${slot.replies.map((r) => `「${r}」`).join("")}`);
  return lines.join("\n");
}

/** 候选方向是动态状态，挑选规则在 propose_resume_designs 的说明里。 */
function candidateLines(candidates: readonly DesignDirection[]): string[] {
  return [
    "- 三版设计只从下面挑 direction（每版一个，三版骨架互不相同）；候选都不合用户要求才自己填 theme。",
    ...candidates.map(
      (d) =>
        `  · ${d.id}｜${d.name}｜骨架 ${d.skeleton}${d.columns ? "（分栏）" : ""}｜字体 ${d.base.bodyFont}/${d.base.headingFont}、抬头 ${d.base.header}、标题 ${d.base.headingStyle}｜${d.words.join("/")}｜${d.craft}`,
    ),
  ];
}

export function buildSystemPrompt(input: PromptInput): string {
  const percent = Math.round(input.completeness.score * 100);
  const progress = Math.round(input.completeness.progress * 100);
  const gaps = input.completeness.gaps.map((g) => g.label);
  const profileJson = JSON.stringify(stripIds(input.profile));
  const sideTopics = [input.jobTools && "岗位", input.polishTool && "润色", input.styleTool && "样式"]
    .filter(Boolean)
    .join("、");
  const lines = [
    input.jobTools
      ? "你是「简聊」的求职助手：通过聊天帮用户整理出完整、真实的求职画像（后续据此生成简历），也帮用户找岗位、解读岗位匹配。"
      : "你是「简聊」的求职顾问，通过聊天帮用户整理出一份完整、真实的求职画像，后续会据此生成简历。",
    "",
    "## 对话原则",
    "- 先用一句话回应用户；用户说完一段话，就把其中明确出现的信息用 upsert_facts 批量写入（一句话含多个事实也一次写入），再按返回的「下一个目标」问下一个问题，问完调用 ask_user，question 填你刚问的那句。",
    "- 每轮只问一件事，口语化、简短，像朋友聊天；问什么由「下一个目标」决定：给了就只问那一项，写「无」就不提问，也不要自己加「还有别的想补充吗」这类话。",
    "- 用户对上一轮刚问的那一项说「没有」「记不清」「没统计过」时，用 skip_field 跳过那一项（不是「当前目标字段」），不要再追问。",
    "- 用户闲聊时，礼貌回应一句再拉回当前目标。用户没有实习、项目时，按系统的挖掘角度一次问一个，可以用画像里的课程、技能提出具体候选；用户确认前什么都不写。",
    ...(sideTopics
      ? [
          `- 用户聊${sideTopics}这类话题时，回应完可以顺带问一个画像里的缺口；用户还想接着聊就继续，不要强行拉回建档。这条消息里同时说了个人信息，照常用 upsert_facts 写入。`,
        ]
      : []),
    `- 不要承诺任何没有工具支持的动作（生成简历、直接改主简历、替用户投递）；只说工具确认过的结果，工具失败、没有改动或还没调用时不能说已经改好、已经采用或已经保存。信息基本齐全或用户说「去生成吧」时告诉用户：${RESUME_HINT}`,
    "- 如果用户说的内容与已记录的信息矛盾，照常写入，系统会自动发出确认问句和按钮；不要自行决定以哪个为准，也不要在文字里复述这个矛盾。",
    "- 工具返回错误时，按提示修正参数后重试一次。",
    ...(input.jobTools
      ? []
      : ["- 暂时没法在聊天里查岗位；用户问岗位时，告诉用户可以去「职位推荐」页看，再接着聊。"]),
    "",
    "## 写事实",
    "- 每条事实必须带 quote：用户消息里的原话片段，逐字摘抄，不要改写。一条事实的依据分散在不相邻的几处时，分别摘抄后用 … 连接，如「2021年9月入学…2025年6月毕业」；每段至少两个字。",
    "- 只写用户明确说过的内容，不要推测、补全或美化；用户没说的字段留空，用追问获取。",
    "- 不要说「记下了」「已记录」「记上了」「已写入」这类话：写没写进简历由界面上的「已写入简历」标签显示，你只回应内容本身，再问下一个问题。",
    "",
    "## 当前画像（已记录的内容）",
    profileJson,
    "",
    `## 简历充实度：${percent}%（建档进度 ${progress}%）`,
    "充实度只看简历里真有的内容，跳过的不算；建档进度只说明问到了哪里。和用户说简历情况时用充实度，不要说「简历已经很完整」来安慰。",
    ...(gaps.length > 0 ? [`简历短板：${gaps.join("、")}`] : []),
  ];
  if (input.designTool) {
    lines.push("", "## 本轮候选方向", ...candidateLines(input.designCandidates ?? []));
  }
  if (input.drafts && input.drafts.length > 0) {
    lines.push("", "## 暂存中（还没写进画像）");
    for (const d of input.drafts) {
      const need = isPlaceholderDraft(d)
        ? "只有泛称；用户说出具体名称或做的是什么时，要用 upsert_facts 以新名称写入，系统会并进这一条"
        : `还缺 ${draftMissing(d).join("、")}`;
      lines.push(`- ${d.section}：${JSON.stringify(stripIds(d.item))}，${need}`);
    }
  }
  if (input.completedSections.length > 0) {
    lines.push(`已完成的分区：${input.completedSections.map((s) => SECTION_BY_NAME[s].label).join("、")}`);
  }
  const skippedKeys = new Set((input.skipped ?? []).map((e) => e.key));
  const pendingNames = input.completeness.missing
    .filter((m) => m.required && !skippedKeys.has(m.key))
    .slice(0, 8)
    .map((m) => `${SECTION_BY_NAME[m.section].label}-${m.itemLabel ? `${m.itemLabel}-` : ""}${m.label}`);
  if (pendingNames.length > 0) lines.push(`仍缺的必填项：${pendingNames.join("、")}`);

  lines.push(...memoryPromptLines(input.skipped ?? [], input.summaries ?? []));

  lines.push("", "## 当前目标字段");
  if (input.autoSkipped) {
    lines.push(
      `用户这句「${input.autoSkipped.quote}」是在回答上一轮问的「${input.autoSkipped.label}」，系统已记为跳过，不要再调用 skip_field，也不要把这句话当成对下面目标的回答。`,
    );
  }
  if (input.hasImage && input.replica) {
    lines.push(
      "这一轮的任务只有一个：复刻用户发来的参考图样式。收到图后马上动手，不要先回复一句「我先看看」就停下；颜色用系统附在消息里的色值，图里的文字不要照搬。不要问建档问题、不要收尾总结，完成复刻并向用户说明后这一轮就结束。",
    );
  } else if (input.closed) {
    lines.push(
      "已经收尾过了：这一轮不要提问，也不要再总结收尾。用户补充了新信息就照常写入，回应完就结束；用户只是致谢或客套，一句话回应即可。",
    );
  } else if (input.slot) {
    lines.push(
      describeSlot(input.slot),
      input.autoSkipped
        ? "简短回应一句，直接问这个目标。"
        : `用户这条消息很可能正是在回答这个目标：先写入，再根据 upsert_facts 返回的「下一个目标」继续追问${input.jobTools ? "；问的是岗位就先回答岗位问题" : ""}。`,
    );
  } else {
    lines.push(`该问的都问过了，这一轮收尾，不要提问。${wrapGuide(input.completeness.tips.length > 0)}`);
  }
  if (input.conflicts.length > 0) {
    lines.push("", "## 待用户确认的矛盾（系统已发出确认问句和按钮）");
    for (const c of input.conflicts) {
      lines.push(
        `- factId=${c.factId}，${c.label}（${c.field}）：之前是「${String(c.previous)}」，现在说「${String(c.proposed)}」`,
      );
    }
    lines.push(
      "- 用户这条消息如果是在选以哪个为准（如「用原来的」「保留之前的」「新的对」「以刚才说的为准」），先调用 resolve_conflict（previous=保留原来的，proposed=采用新的，quote 摘抄用户这句原话），再按返回的「下一个目标」接着问。",
      "- 不要在文字里复述或再次追问这个矛盾，问句和按钮由系统发出；用户说的内容和矛盾无关时，正常回应、写入并追问即可，不必催用户选。",
    );
  }
  return lines.join("\n");
}
