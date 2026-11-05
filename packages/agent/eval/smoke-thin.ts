import { Profile, profileToResume } from "@talksume/core";
import { createGateway, loadGatewayConfig } from "@talksume/llm-gateway";
import { computeCompleteness, createIntakeController, createIntakeState } from "../src/index.ts";

/** 冒烟：模型扮演经历很少的虚构大专生李明，看助手能把简历挖到多充实、有没有编造。 */
const PERSONA = `你在扮演一个求职的学生，和简历助手聊天。只根据下面的设定回答，设定里没有的经历、数字、技能一律说没有或不知道，绝不编造。
设定：
- 李明，江城职业技术学院，软件技术专业，大专，2023年9月入学，2026年6月毕业。手机 13800001234，邮箱 liming@example.com，人在江城。
- 只学过 Java 和 MySQL，课上学的，谈不上熟练。没学过别的框架和语言。
- 没有任何实习和兼职，没参加过比赛，没有证书，没有奖学金，没有 GitHub 和博客，没帮老师做过东西，没自学做过别的作品。
- 大二下学期的 Java 课程设计：和两个同学一起做了个学生成绩管理系统，你负责成绩录入和查询那部分，界面用 Java Swing，数据存在 MySQL，写了增删改查。碰到过中文乱码，后来把数据库和连接的编码都改成 UTF-8 解决了。没有任何数字结果。
- 大一在学校计算机协会，参与组织过一次给同学免费清灰、重装系统的电脑义诊活动，你负责现场登记和帮同学装系统。没统计过人数。
- 想找江城的 Java 开发校招岗位，2026年7月能到岗，薪资无所谓。
说话方式：
- 回答简短口语，一次只回答被问的那件事，像普通学生打字。
- 你觉得课程设计、社团活动都不算「项目」或「经历」：被笼统问到项目、实习、工作经历时，只说「没有」「没做过什么项目」。只有被明确问到课程设计/大作业时才讲课程设计；只有被明确问到社团/学生活动/志愿者时才讲义诊。
- 助手给了快捷选项、而其中有符合设定的，可以直接照抄那个选项作为回答。
- 只输出你要说的话，不要加引号或说明。`;

const config = loadGatewayConfig();
const gateway = createGateway(config);
const controller = createIntakeController({
  streamFn: gateway.streamFn("eval.smoke"),
  model: gateway.primaryModel,
});
const state = createIntakeState({ profile: Profile.parse({}) });

const transcript: string[] = [];
let text = "你好，我想做一份简历，找 Java 开发的工作";
const maxTurns = Number(process.argv[2] ?? 28);
for (let round = 1; round <= maxTurns; round++) {
  let reply = "";
  for await (const event of controller.handleUserMessage(state, { id: `m${round}`, text })) {
    if (event.type === "token") reply += event.text;
    else if (event.type === "ask") {
      if (!event.inText) reply += `${reply ? "\n" : ""}${event.question}`;
      if (event.quickReplies) reply += `\n［快捷回答：${event.quickReplies.join(" / ")}］`;
    } else if (event.type === "error") reply += `\n［错误 ${event.code}］`;
  }
  transcript.push(`李明：${text}`, `助手：${reply.trim()}`);
  console.log(`\n第 ${round} 轮\n李明：${text}\n助手：${reply.trim()}`);
  if (/右侧预览|导出|基本收集完整|信息已经比较完整/.test(reply) && round > 6) break;
  text = (await simulateUser()).replace(/^李明[：:]\s*/, "");
}

async function simulateUser(): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await gateway.complete({
        purpose: "eval.smoke.user",
        system: PERSONA,
        prompt: `对话记录：\n${transcript.slice(-12).join("\n")}\n\n请以李明的身份回复助手最后一句。`,
        temperature: 0.3,
        maxTokens: 200,
      });
      return res.text.trim();
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

const completeness = computeCompleteness(state.profile, { completedSections: state.completedSections });
const extra = completeness as unknown as { progress?: number; gaps?: { title: string }[] };
console.log("\n===== 结果 =====");
console.log(
  `完整度 score=${Math.round(completeness.score * 100)}%${extra.progress !== undefined ? ` progress=${Math.round(extra.progress * 100)}%` : ""}`,
);
if (extra.gaps) console.log("缺口：", extra.gaps.map((g) => g.title).join("；"));
console.log("跳过：", state.skipped.map((s) => s.label).join("、") || "无");
console.log("已完成分区：", state.completedSections.join("、"));
console.log("\n事实（quote → payload）：");
for (const f of state.facts.filter((x) => x.status === "confirmed")) {
  console.log(`- [${f.section}] 「${f.quote}」 → ${JSON.stringify(f.payload)}`);
}
console.log("\n简历：");
for (const section of profileToResume(state.profile).sections) {
  console.log(`## ${section.title}`);
  for (const item of section.items) {
    console.log(`${item.heading}${item.subheading ? `｜${item.subheading}` : ""}`);
    if (item.techStack) console.log(`  技术栈：${item.techStack.join(" / ")}`);
    for (const b of item.bullets) console.log(`  - ${b.lead ? `**${b.lead}**：` : ""}${b.text}`);
  }
}
