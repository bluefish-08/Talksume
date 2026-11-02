import type { Profile, ProfileSection } from "@talksume/core";
import { type Completeness, SECTION_BY_NAME, type Slot } from "./completeness.ts";
import { type Conflict, type Draft, draftMissing } from "./facts.ts";

export interface PromptInput {
  profile: Profile;
  completeness: Completeness;
  slot: Slot | null;
  completedSections: readonly ProfileSection[];
  conflicts: readonly Conflict[];
  drafts?: readonly Draft[];
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
    "- 三个工具：upsert_facts 写入事实、ask_user 结束本轮等用户回答、complete_section 结束分区。回应和下一个问题直接用文字写出来，写完调用 ask_user，question 填你刚问的那句。",
    "- 用户每说完一段话，先把其中明确出现的信息用 upsert_facts 批量写入，再用 ask_user 问下一个问题。一句话含多个事实就一次写入。",
    "- 每条事实必须带 quote：用户消息里的原话片段，逐字摘抄，不要改写。",
    "- 只写用户明确说过的内容，不要推测、补全或美化；用户没说的字段留空，用追问获取。",
    "- 每次只问一件事，口语化、简短，像朋友聊天。可以先用一句话回应或确认用户刚说的内容。",
    "- 技能熟练度 level 按用户原话映射：了解/入门→beginner，熟悉→familiar，熟练/擅长→proficient，精通→expert；用户没说程度就省略 level，不要自行填写或降级。",
    "- ask_user 时尽量附带 quickReplies：2 到 4 条用户可能的简短回答（第一人称、12 字以内，可含「跳过这个」）。选项必须是用户真实可能的回答，不要替用户编造经历；不确定就不给。",
    "- 时间统一写成 YYYY-MM；学位用 associate/bachelor/master/phd；求职类型用 internship/campus/experienced。",
    "- 用户跑题或闲聊时，礼貌回应一句再拉回当前目标。用户不想回答某项时，不要强迫，用 complete_section（reason=user_skipped）跳过。",
    "- 如果用户说的内容与已记录的信息矛盾，照常写入，系统会自动请用户确认，你不要自行决定以哪个为准。",
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
  const pendingNames = input.completeness.missing
    .filter((m) => m.required)
    .slice(0, 8)
    .map((m) => `${SECTION_BY_NAME[m.section].label}-${m.itemLabel ? `${m.itemLabel}-` : ""}${m.label}`);
  if (pendingNames.length > 0) lines.push(`仍缺的必填项：${pendingNames.join("、")}`);

  lines.push("", "## 当前目标字段");
  if (input.slot) {
    lines.push(
      describeSlot(input.slot),
      "用户这条消息很可能正是在回答这个目标：先写入，再根据 upsert_facts 返回的「下一个目标」继续追问。",
    );
  } else {
    lines.push("信息已基本收集完整。可以简短总结，并告诉用户可以去生成简历了。");
  }
  if (input.conflicts.length > 0) {
    lines.push("", "## 待用户确认的矛盾（先不要追问其他内容）");
    for (const c of input.conflicts) {
      lines.push(`- ${c.label}：之前是「${String(c.previous)}」，现在说「${String(c.proposed)}」`);
    }
  }
  return lines.join("\n");
}
