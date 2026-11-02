import { Profile, profileToResume } from "@talksume/core";
import { createGateway, loadGatewayConfig } from "@talksume/llm-gateway";
import { createIntakeController, createIntakeState } from "../src/index.ts";

/** 冒烟：虚构的李明只说一句做过什么，看助手能否几轮内问出技术栈、职责、难点和结果。 */
const ANSWERS: [RegExp, string][] = [
  [/技术|栈|框架|工具|语言/, "后端用的 Spring Boot 和 MySQL，缓存用 Redis。"],
  [/负责|分工|哪一块|做了什么|角色/, "我负责商品发布和订单模块的接口，还有后台的权限管理。"],
  [/难|挑战|问题|坑|麻烦/, "最麻烦的是热门商品抢购时会超卖，我用 Redis 分布式锁加数据库乐观锁解决了。"],
  [
    /效果|结果|数字|数据|提升|用户量|性能/,
    "上线一个学期有 3000 多个注册用户，下单接口平均响应从 500ms 降到了 80ms。",
  ],
];

const config = loadGatewayConfig();
const gateway = createGateway(config);
const controller = createIntakeController({
  streamFn: gateway.streamFn("eval.smoke"),
  model: gateway.primaryModel,
});

const state = createIntakeState({
  profile: Profile.parse({
    basics: {
      name: "李明",
      phone: "13800001234",
      email: "liming@example.com",
      city: "江城",
      summary: "后端方向的应届生",
      links: [{ label: "GitHub", url: "github.com/liming-demo" }],
    },
    education: [
      {
        id: "edu_1",
        school: "江城大学",
        degree: "bachelor",
        major: "软件工程",
        start: "2022-09",
        end: "2026-06",
        gpa: "3.5",
        courses: ["数据结构", "数据库原理"],
      },
    ],
    skills: ["Java", "MySQL", "Git"].map((name, i) => ({ id: `skl_${i}`, name, category: "后端" })),
    intention: { roles: ["后端开发"], cities: ["江城"], jobType: "campus", availableFrom: "2026-07" },
  }),
  completedSections: ["experiences", "awards"],
});

const used = new Set<number>();
let text = "做过校园二手平台的后端";
const maxTurns = Number(process.argv[2] ?? 6);
for (let round = 1; round <= maxTurns; round++) {
  let reply = "";
  for await (const event of controller.handleUserMessage(state, { id: `m${round}`, text })) {
    if (event.type === "token") reply += event.text;
    else if (event.type === "ask") {
      if (!event.inText) reply += `${reply ? "\n" : ""}${event.question}`;
      if (event.quickReplies) reply += `\n［快捷回答：${event.quickReplies.join(" / ")}］`;
    } else if (event.type === "error") reply += `\n［错误 ${event.code}］`;
  }
  console.log(`\n第 ${round} 轮\n李明：${text}\n助手：${reply.trim()}`);
  const next = ANSWERS.findIndex(([re], i) => !used.has(i) && re.test(reply));
  if (next < 0) break;
  used.add(next);
  text = ANSWERS[next]?.[1] as string;
}

const project = state.profile.projects[0];
console.log(
  "\n画像中的项目：",
  JSON.stringify(project, ["name", "role", "techStack", "highlights", "title", "detail"], 1),
);
console.log("跳过：", state.skipped.map((s) => s.label).join("、") || "无");
const item = profileToResume(state.profile)
  .sections.flatMap((s) => s.items)
  .find((i) => i.heading === project?.name);
console.log("\n简历上的这段：");
if (item) {
  console.log(`${item.heading}｜${item.subheading ?? ""}`);
  if (item.techStack) console.log(`技术栈：${item.techStack.join(" / ")}`);
  for (const b of item.bullets) console.log(`- ${b.lead ? `**${b.lead}**：` : ""}${b.text}`);
}
