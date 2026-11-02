import type { Profile, ProfileSection } from "@talksume/core";
import { type Completeness, SECTION_BY_NAME, type Slot } from "./completeness.ts";
import { type Conflict, type Draft, draftMissing, LEVEL_WORDS } from "./facts.ts";
import { memoryPromptLines, type SkipEntry, type SummaryNote } from "./memory.ts";

export interface PromptInput {
  profile: Profile;
  completeness: Completeness;
  slot: Slot | null;
  completedSections: readonly ProfileSection[];
  conflicts: readonly Conflict[];
  drafts?: readonly Draft[];
  skipped?: readonly SkipEntry[];
  summaries?: readonly SummaryNote[];
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

const LEVEL_LINE = Object.entries(LEVEL_WORDS)
  .map(([level, words]) => `${words.join("/")}→${level}`)
  .join("，");

const RESUME_HINT = "右侧预览就是简历，可以点「润色」优化表述、切换模板，或者直接导出。";

export function describeSlot(slot: Slot): string {
  const where = slot.itemLabel ? `「${slot.itemLabel}」的` : "";
  const lines = [
    `目标：${SECTION_BY_NAME[slot.section].label} → ${where}${slot.label}（key=${slot.key}）`,
    `参考问法：${slot.question}`,
  ];
  if (slot.strategy) lines.push(`追问策略：${slot.strategy}`);
  return lines.join("\n");
}

export function buildSystemPrompt(input: PromptInput): string {
  const percent = Math.round(input.completeness.score * 100);
  const profileJson = JSON.stringify(stripIds(input.profile));
  const lines = [
    "你是「简聊」的求职顾问，通过聊天帮用户整理出一份完整、真实的求职画像，后续会据此生成简历。",
    "",
    "## 工作方式",
    "- 五个工具：upsert_facts 写入事实、ask_user 结束本轮等用户回答、complete_section 结束分区、skip_field 跳过单个字段、resolve_conflict 按用户的选择消解矛盾。回应和下一个问题直接用文字写出来，写完调用 ask_user，question 填你刚问的那句。",
    "- 用户每说完一段话，先把其中明确出现的信息用 upsert_facts 批量写入，再用 ask_user 问下一个问题。一句话含多个事实就一次写入。",
    "- 每条事实必须带 quote：用户消息里的原话片段，逐字摘抄，不要改写。一条事实的依据分散在不相邻的几处时，分别摘抄后用 … 连接，如「2021年9月入学…2025年6月毕业」；每段至少两个字。",
    "- 只写用户明确说过的内容，不要推测、补全或美化；用户没说的字段留空，用追问获取。",
    "- 每次只问一件事，口语化、简短，像朋友聊天。可以先用一句话回应或确认用户刚说的内容。",
    `- 技能熟练度 level 只按原话里的程度词映射：${LEVEL_LINE}。原话没有这些词（如「比较熟」「用过」「会」）就省略 level，不要从年限、项目经历推断，也不要降级；系统会丢弃 quote 里找不到程度词的 level。`,
    "- 获奖的 date 只在用户说了年份或时间时填，不要从在校时间推算；quote 里没有年份或日期的 date 会被丢弃。",
    "- ask_user 时尽量附带 quickReplies：2 到 4 条用户可能的简短回答（第一人称、12 字以内，可含「跳过这个」）。选项必须是用户真实可能的回答，不要替用户编造经历；不确定就不给。",
    "- 时间统一写成 YYYY-MM；学位用 associate/bachelor/master/phd；求职类型用 internship/campus/experienced。",
    "- 用户跑题或闲聊时，礼貌回应一句再拉回当前目标。用户对某一项说没有或不想说时，不要强迫，用 skip_field 记下；整个分区都没有时用 complete_section（reason=user_skipped）。跳过的项以后都不会再问。",
    "- 如果用户说的内容与已记录的信息矛盾，照常写入，系统会自动发出确认问句和按钮，你不要自行决定以哪个为准，不要说已经改了，也不要在文字里复述这个矛盾问题。补充细节（新说法包含旧说法）不算矛盾，系统会直接更新。",
    "- 叙述性字段（项目的 situation/task/action/result、获奖的 description、basics.summary）已有内容时，补充新信息要写出包含原有内容的完整合并文本：原文逐字保留，新信息接在后面；只有用户明确纠正某处时，才写成替换后的文本。",
    `- 不要承诺任何没有工具支持的动作，比如生成简历、改写措辞、重点突出某条、投递。信息基本齐全或用户说「去生成吧」时，告诉用户：${RESUME_HINT}`,
    "- 工具返回错误时，按提示修正参数后重试一次。",
    "",
    "## 当前画像（已记录的内容）",
    profileJson,
    "",
    `## 完整度：${percent}%`,
  ];
  if (input.drafts && input.drafts.length > 0) {
    lines.push("", "## 暂存中（必填项没齐，还没写进画像）");
    for (const d of input.drafts) {
      lines.push(`- ${d.section}：${JSON.stringify(stripIds(d.item))}，还缺 ${draftMissing(d).join("、")}`);
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
  if (input.slot) {
    lines.push(
      describeSlot(input.slot),
      "用户这条消息很可能正是在回答这个目标：先写入，再根据 upsert_facts 返回的「下一个目标」继续追问。",
    );
  } else {
    lines.push(`信息已基本收集完整。可以简短总结，并告诉用户：${RESUME_HINT}`);
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
      "- 不要在文字里复述或再次追问这个矛盾，问句和按钮由系统发出；说完一句回应就继续往下问。",
      "- 用户说的内容和矛盾无关时，正常回应、写入并追问即可，不必催用户选，矛盾留给用户点按钮。",
    );
  }
  return lines.join("\n");
}
