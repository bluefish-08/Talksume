import { Profile, profileToResume } from "@talksume/core";
import { createGateway, loadGatewayConfig } from "@talksume/llm-gateway";
import { createIntakeController, createIntakeState } from "../src/index.ts";

/** 冒烟：老数据里的项目已有 action/result，没有 highlights；看助手会不会重复追问、重复写要点。 */
const OLD = "江城闲置";
const NEW = "江城图书馆";

/** 只看助手最后一个问句和目标条目来回答，同一句不答两次。 */
const used = new Set<string>();
function answer(question: string, aboutOld: boolean): string | undefined {
  const pick = (text: string) => (used.has(text) ? undefined : (used.add(text), text));
  if (/负责|哪一块|哪块|分工|做了什么/.test(question) && aboutOld)
    return pick("之前说过了呀，就是商品发布、搜索和订单模块");
  if (/角色|担任|负责|哪一块|哪块/.test(question)) return pick("我是组长，负责图书借阅和预约模块。");
  if (/技术|栈|框架|工具/.test(question)) return pick("用的 Python 和 Flask，数据库是 SQLite。");
  if (/难|挑战|问题|麻烦/.test(question))
    return pick(
      aboutOld
        ? "最难的是热门商品搜索很慢，我加了 Redis 缓存和分页，才把响应降下来。"
        : "最麻烦的是预约冲突，我用数据库唯一约束加事务解决了重复预约。",
    );
  if (/效果|结果|数字|数据|提升/.test(question)) return pick("没有具体数字，课程答辩拿了优秀。");
  return undefined;
}

const gateway = createGateway(loadGatewayConfig());
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
        courses: ["数据结构"],
      },
    ],
    projects: [
      {
        id: "prj_old",
        name: OLD,
        role: "后端负责人",
        techStack: ["Java", "Spring Boot", "MySQL", "Redis"],
        situation: "校园二手交易小程序",
        action: "负责后端，做了商品发布、搜索和订单模块，用 Redis 缓存热门商品",
        result: "接口响应从 800ms 降到 120ms，上线三个月有 2000 多个注册用户",
      },
    ],
    skills: ["Java", "MySQL", "Git"].map((name, i) => ({ id: `skl_${i}`, name, category: "后端" })),
    intention: { roles: ["后端开发"], cities: ["江城"], jobType: "campus", availableFrom: "2026-07" },
  }),
  completedSections: ["experiences", "awards"],
});

let text = `我还做过一个课程项目叫${NEW}`;
let repeated = 0;
const maxTurns = Number(process.argv[2] ?? 6);
for (let round = 1; round <= maxTurns; round++) {
  let reply = "";
  let target = "";
  for await (const event of controller.handleUserMessage(state, { id: `m${round}`, text })) {
    if (event.type === "token") reply += event.text;
    else if (event.type === "ask") {
      if (!event.inText) reply += `${reply ? "\n" : ""}${event.question}`;
      if (event.slot) target = event.slot.key;
    } else if (event.type === "error") reply += `\n［错误 ${event.code}］`;
  }
  const question =
    reply
      .split(/\n|(?<=[。！])/)
      .filter((x) => /[?？]/.test(x))
      .at(-1) ?? "";
  const aboutOld = target.includes("prj_old") || question.includes(OLD);
  const again = aboutOld && /负责|哪一块|哪块/.test(question) && !/难|挑战/.test(question);
  if (again) repeated++;
  console.log(
    `\n第 ${round} 轮\n李明：${text}\n助手：${reply.trim()}${target ? `\n［目标 ${target}］` : ""}${again ? "\n⚠ 重复追问已答过的职责" : ""}`,
  );
  const next = answer(question, aboutOld);
  if (!next) break;
  text = next;
}

const resume = profileToResume(state.profile);
for (const name of [OLD, NEW]) {
  const item = resume.sections.flatMap((s) => s.items).find((i) => i.heading === name);
  console.log(`\n简历上的「${name}」：`);
  if (!item) continue;
  if (item.techStack) console.log(`技术栈：${item.techStack.join(" / ")}`);
  for (const b of item.bullets) console.log(`- ${b.lead ? `**${b.lead}**：` : ""}${b.text}`);
}
console.log(`\n重复追问 ${repeated} 次；跳过：${state.skipped.map((s) => s.label).join("、") || "无"}`);
