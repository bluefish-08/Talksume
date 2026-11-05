import { exhaustPlanner, type Script, type ScriptTurn } from "./builder.ts";
import { C, type Check, entityNames, has, projectWith } from "./checks.ts";

export interface Probe {
  id: string;
  title: string;
  /** 状态从哪来、为什么这样期望。 */
  note: string;
  script: Script;
  message: string;
  checks: Check[];
}

const SCHOOL = "江城职业技术学院";
const PROJECT = "学生成绩管理系统";

/** ds-smoke2 前 14 轮原样重建，含空条目「Java 课程设计」（审查实验 A/B 的状态）。 */
const SMOKE2: ScriptTurn[] = [
  {
    user: "你好，我想做一份简历，找 Java 开发的工作",
    reply: "你好！很高兴帮你整理简历。先认识一下，怎么称呼你？",
    facts: [{ section: "intention", quote: "找 Java 开发的工作", payload: { roles: ["Java 开发"] } }],
  },
  {
    user: "我叫李明",
    reply: "李明你好～方便留一个手机号吗？投递简历时 HR 会用到。",
    facts: [{ section: "basics", quote: "我叫李明", payload: { name: "李明" } }],
  },
  {
    user: "13800001234",
    reply: "好的，那邮箱呢？HR 发面试通知一般用这个。",
    facts: [{ section: "basics", quote: "13800001234", payload: { phone: "13800001234" } }],
  },
  {
    user: "liming@example.com",
    reply: "邮箱记好了。接下来聊聊你的教育经历——你读的是哪所学校、什么专业？",
    facts: [{ section: "basics", quote: "liming@example.com", payload: { email: "liming@example.com" } }],
  },
  {
    user: `${SCHOOL}，软件技术专业，大专`,
    reply: `${SCHOOL}软件技术专业，了解了。在校时间大概是什么时候到什么时候？`,
    facts: [
      {
        section: "education",
        quote: `${SCHOOL}，软件技术专业，大专`,
        payload: { school: SCHOOL, degree: "associate", major: "软件技术" },
      },
    ],
  },
  {
    user: "2023年9月入学，2026年6月毕业",
    reply: "好，专科三年。在校期间有拿过奖学金或者比赛奖项吗？",
    facts: [
      {
        section: "education",
        quote: "2023年9月入学，2026年6月毕业",
        payload: { school: SCHOOL, start: "2023-09", end: "2026-06" },
      },
    ],
  },
  { user: "没有", reply: "好，那在校期间有没有参加过课程设计、大作业或者毕设这类项目？" },
  {
    user: "做过一个课程设计，Java 的",
    reply: "能具体说说这个课程设计做的是什么吗？比如是图书管理、学生成绩管理这类系统？",
    facts: [{ section: "projects", quote: "做过一个课程设计，Java 的", payload: { name: "Java 课程设计" } }],
  },
  {
    user: PROJECT,
    reply: `${PROJECT}，不错。这个项目用到哪些技术或者工具，比如 JDK、MySQL、Swing、IDEA 之类的？`,
  },
  {
    user: "Java Swing 做界面，数据存在 MySQL 里，就学了这些",
    reply: "Swing 做界面、MySQL 存数据，思路挺清晰。那你在项目里具体负责哪部分？是一个人做的还是跟同学一起？",
    facts: [
      {
        section: "projects",
        quote: `${PROJECT}…Java Swing 做界面，数据存在 MySQL 里`,
        payload: { name: PROJECT, techStack: ["Java Swing", "MySQL"] },
      },
    ],
  },
  {
    user: "跟两个同学一起做的，我负责成绩录入和查询那块",
    reply:
      "跟同学一起做，你负责成绩录入和查询。实现成绩录入和查询的时候，有遇到什么卡住你的地方吗？比如数据校验、SQL 写法这些。",
  },
  {
    user: "碰到过中文乱码，后来把数据库和连接的编码都改成 UTF-8 就好了",
    reply: "乱码这个坑挺典型。那这个项目最后有统计过什么结果吗，比如录入多少条数据、查询快不快之类的？",
    facts: [
      {
        section: "projects",
        quote:
          "跟两个同学一起做的，我负责成绩录入和查询那块…碰到过中文乱码，后来把数据库和连接的编码都改成 UTF-8 就好了",
        payload: {
          name: PROJECT,
          role: "负责成绩录入与查询模块",
          highlights: [
            {
              title: "成绩录入与查询",
              detail: "负责成绩录入与查询模块，界面基于 Java Swing 实现，数据存储于 MySQL",
            },
            { title: "中文乱码处理", detail: "解决中文乱码问题，将数据库与数据库连接的编码统一改为 UTF-8" },
          ],
        },
      },
    ],
  },
  {
    user: "没有，没统计过这些",
    reply: "这个课程设计的内容差不多清楚了。那你有过实习或者兼职工作的经历吗？没有的话直接说一声就行。",
    slot: /^experiences:_:_item$/,
  },
  {
    user: "没有",
    reply:
      "明白，实习这块先空着。接下来聊聊技能，除了 Java、Swing 和 MySQL，你还会用别的语言或工具吗？比如 HTML/CSS、Python、Linux、Git 这些？",
    skip: true,
  },
];

/** 干净的李明台词：裸确认不建条目，事实在说出的那一轮写入。 */
const LM: ScriptTurn[] = [
  ...SMOKE2.slice(0, 6),
  { user: "没有", reply: "好，那在校期间有没有做过课程设计、大作业或者毕设这类项目？" },
  { user: "做过一个课程设计，Java 的", reply: "能具体说说这个课程设计做的是什么系统吗？" },
  {
    user: `${PROJECT}，用 Java Swing 做界面，数据存在 MySQL 里`,
    reply: "思路挺清晰。你在项目里具体负责哪部分？",
    facts: [
      {
        section: "projects",
        quote: `${PROJECT}，用 Java Swing 做界面，数据存在 MySQL 里`,
        payload: { name: PROJECT, techStack: ["Java Swing", "MySQL"] },
      },
    ],
  },
  {
    user: "跟两个同学一起做的，我负责成绩录入和查询那块",
    reply: "实现成绩录入和查询的时候，有遇到什么卡住你的地方吗？",
    facts: [
      {
        section: "projects",
        quote: "跟两个同学一起做的，我负责成绩录入和查询那块",
        payload: {
          name: PROJECT,
          role: "负责成绩录入与查询模块",
          highlights: [{ title: "成绩录入与查询", detail: "与两名同学合作，负责成绩录入与查询模块" }],
        },
      },
    ],
    slot: /:challenge$/,
  },
  {
    user: "碰到过中文乱码，后来把数据库和连接的编码都改成 UTF-8 就好了",
    reply: "这个项目最后有统计过什么结果吗，比如录入多少条数据、查询快不快？",
    facts: [
      {
        section: "projects",
        quote: "碰到过中文乱码，后来把数据库和连接的编码都改成 UTF-8 就好了",
        payload: {
          name: PROJECT,
          highlights: [
            { title: "中文乱码处理", detail: "解决中文乱码问题，将数据库与连接编码统一改为 UTF-8" },
          ],
        },
      },
    ],
  },
];

const upTo = (turns: ScriptTurn[], n: number, last?: Partial<ScriptTurn>) =>
  turns.slice(0, n).map((t, i) => (i === n - 1 && last ? { ...t, ...last } : t));

const CORRECTION = "哦对了，刚才说错了，我是 2026 年 7 月毕业，不是 6 月";

export const PROBES: Probe[] = [
  {
    id: "skills-answer",
    title: "回答技能（ds-smoke2 第 15 轮）",
    note: "审查实验 A 的原状态：规划器目标被空条目带偏到「Java 课程设计」的担任角色；用户在回答技能。现状 0/8。",
    script: { turns: SMOKE2, countAsks: false },
    message: "没有，就学过 Java 和 MySQL，别的没学过",
    checks: [
      C.profile(
        "skills:java+mysql",
        "技能写入 Java 和 MySQL",
        (p) => has(p.skills, /^java$/i) && has(p.skills, /mysql/i),
      ),
      C.items("projects", 0),
      C.maxQuestions(1),
      C.profile("skills:noSwing", "技术栈不复制成技能（无 Swing）", (p) => !has(p.skills, /swing/i), false),
    ],
  },
  {
    id: "bare-confirm",
    title: "裸确认「做过课程设计」",
    note: "只说做过、没说做的是什么，不应在画像里建条目（暂存可以）。",
    script: { turns: LM.slice(0, 7) },
    message: "做过一个课程设计，Java 的",
    checks: [C.items("projects", 0), C.maxQuestions(1), C.questions(1, false)],
  },
  {
    id: "confirm-then-name",
    title: "确认后说出名字",
    note: "上一轮已建了空条目或占位「Java 课程设计」，这轮说出名字，应改名或合并，不应新建（暂存转正不算新建）。",
    script: { turns: SMOKE2.slice(0, 8), countAsks: false },
    message: `${PROJECT}，跟两个同学一起做的`,
    checks: [
      C.entities("projects", 0),
      C.custom("project:named", "画像或暂存里的项目名出现「成绩管理」", (o) =>
        entityNames(o.after, "projects").some((n) => /成绩管理/.test(n)),
      ),
      C.maxQuestions(1),
    ],
  },
  {
    id: "difficulty-answer",
    title: "回答难点",
    note: "上一轮问的是难点（slot=difficulty），用户给出了具体难点和做法。",
    script: { turns: LM.slice(0, 10) },
    message: "碰到过中文乱码，后来把数据库和连接的编码都改成 UTF-8 就好了",
    checks: [
      C.profile("highlight:utf8", "项目要点写入乱码/UTF-8", (p) =>
        /乱码|utf-?8/i.test(JSON.stringify(projectWith(p, /成绩管理/)?.highlights ?? [])),
      ),
      C.items("projects", 0),
      C.maxQuestions(1),
      C.profile("skills:noUtf8", "不把 UTF-8 记成技能", (p) => !has(p.skills, /utf/i), false),
    ],
  },
  {
    id: "short-decline",
    title: "短拒答",
    note: "上一轮问的是量化结果（slot=impact），用户只说「没有」。NO_NUMBERS 正则不覆盖光秃秃的「没有」，要靠模型跳过。",
    script: {
      turns: upTo(LM, 10, {
        reply: "这个项目最后有统计过什么结果吗，比如录入多少条数据、查询快不快？",
        slot: /:impact$/,
      }),
    },
    message: "没有",
    checks: [C.noWrite(), C.skipped(/:impact$/), C.maxQuestions(1)],
  },
  {
    id: "no-info",
    title: "没有信息的消息",
    note: "ds-smoke2 第 14 轮之后，用户只说了句没信息的话。不应写入、不应跳过（审查实验 F 的误跳过场景）。",
    script: { turns: SMOKE2, countAsks: false },
    message: "嗯，还有啥要问的吗",
    checks: [C.noWrite(), C.noSkip(), C.maxQuestions(1), C.questions(1, false)],
  },
  {
    id: "multi-facts",
    title: "一句话说多件事",
    note: "上一轮问奖项，用户顺带说了社团活动和课程设计。",
    script: { turns: LM.slice(0, 6) },
    message: `奖倒是没拿过。不过大一在计算机协会参与组织过一次电脑义诊，我负责现场登记和帮同学重装系统；大二还做过一个 Java 课程设计，是${PROJECT}，用 Swing 和 MySQL 写的`,
    checks: [
      C.profile("project:yizhen", "写入义诊", (p) => Boolean(projectWith(p, /义诊/))),
      C.profile("project:course", "写入成绩管理系统", (p) => Boolean(projectWith(p, /成绩管理/))),
      C.items("awards", 0),
      C.maxQuestions(1),
      C.profile(
        "project:yizhenCampus",
        "义诊记为校园经历",
        (p) => projectWith(p, /义诊/)?.kind === "campus",
        false,
      ),
      C.profile(
        "project:courseTech",
        "课程设计带上 MySQL",
        (p) => /mysql/i.test(JSON.stringify(projectWith(p, /成绩管理/)?.techStack ?? [])),
        false,
      ),
    ],
  },
  {
    id: "correction",
    title: "纠正",
    note: "用户主动改口毕业时间。直接改或发起确认都算对，不能新建教育条目。",
    script: { turns: LM.slice(0, 6) },
    message: CORRECTION,
    checks: [
      C.custom("edu:end", "毕业时间改为 2026-07 或已发起确认", (o) => {
        const edu = o.after.profile.education[0];
        return edu?.end === "2026-07" || o.after.conflicts.some((c) => String(c.proposed) === "2026-07");
      }),
      C.items("education", 0),
      C.maxQuestions(1),
    ],
  },
  {
    id: "conflict-choice",
    title: "在矛盾待确认时做选择",
    note: "上一轮改口生成了待确认矛盾（6 月 → 7 月），系统已发出确认问句，用户这轮在文字里选。",
    script: {
      turns: [
        ...LM.slice(0, 6),
        {
          user: CORRECTION,
          reply: "好的。你之前说毕业时间是「2026-06」，刚才说的是「2026-07」，以哪个为准？",
          facts: [
            { section: "education", quote: "2026 年 7 月毕业", payload: { school: SCHOOL, end: "2026-07" } },
          ],
          slot: null,
        },
      ],
    },
    message: "以刚才说的为准，7 月毕业",
    checks: [
      C.noConflictLeft(),
      C.profile("edu:end", "毕业时间为 2026-07", (p) => p.education[0]?.end === "2026-07"),
      C.items("education", 0),
      C.maxQuestions(1),
    ],
  },
  {
    id: "mixed-jobs",
    title: "建档和问岗位混在一句",
    note: "上一轮问到岗时间，用户回答后顺带问岗位。应写入到岗时间，同时查岗位。",
    script: {
      turns: upTo(LM, 6, { reply: "好，专科三年。另外你最快什么时候能到岗？", slot: /availableFrom/ }),
    },
    message: "2026 年 7 月就能到岗。对了，江城现在有招 Java 开发的岗位吗？",
    checks: [
      C.profile(
        "intention:available",
        "写入到岗时间 2026-07",
        (p) => p.intention.availableFrom === "2026-07",
      ),
      C.calledJobs(),
      C.maxQuestions(1),
    ],
  },
  {
    id: "wrap-point",
    title: "收尾点",
    note: "规划器已经没有待问项（剩余项全部记为跳过），用户说没有了。应收尾，收尾后不再提问，不出现「不过还差一项」。",
    script: {
      turns: [
        ...LM,
        {
          user: "就学过 Java 和 MySQL",
          reply: "好的。还有别的想补充的吗？比如证书、社团活动？",
          facts: [
            { section: "skills", quote: "Java", payload: { name: "Java" } },
            { section: "skills", quote: "MySQL", payload: { name: "MySQL" } },
          ],
          slot: null,
        },
      ],
      prepare: (state, target) => exhaustPlanner(state, target),
    },
    message: "没有了，就这些",
    checks: [C.noWrite(), C.wraps(), C.noWrapThenAsk(), C.noLastItem()],
  },
  {
    id: "chitchat",
    title: "闲聊",
    note: "上一轮问难点，用户闲聊了一句。不写入、不跳过，回到正题时只问一个问题。",
    script: { turns: LM.slice(0, 10) },
    message: "哈哈你回得好快，你是真人还是 AI 啊",
    checks: [C.noWrite(), C.noSkip(), C.maxQuestions(1), C.questions(1, false)],
  },
];
