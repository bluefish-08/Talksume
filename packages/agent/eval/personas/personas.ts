import type { ExpectedProfile } from "../dataset.ts";

export interface Persona {
  id: string;
  name: string;
  title: string;
  opening: string;
  /** 只写设定和说话方式；通用规则由 userSystem 拼上。 */
  setting: string;
  style: string;
  expected: ExpectedProfile;
}

const COMMON = `只根据下面的设定回答，设定里没有的经历、数字、技能一律说没有或不知道，绝不编造。
助手给了快捷选项、而其中有符合设定的，可以直接照抄那个选项作为回答。
助手问「还有别的吗」「还有要补充的吗」而设定里该说的都说过了，就说没有了。
助手说简历已经差不多了、可以去右侧预览或导出时，简单道谢即可，不要再提新信息。
只输出你要说的话，不要加引号、名字前缀或说明。`;

export function userSystem(p: Persona): string {
  return `你在扮演一个求职者${p.name}，和简历助手聊天。${COMMON}\n设定：\n${p.setting}\n说话方式：\n${p.style}`;
}

export const PERSONAS: Persona[] = [
  {
    id: "thin",
    name: "李明",
    title: "经历少的专科生",
    opening: "你好，我想做一份简历，找 Java 开发的工作",
    setting: `- 李明，江城职业技术学院，软件技术专业，大专，2023年9月入学，2026年6月毕业。手机 13800001234，邮箱 liming@example.com，人在江城。
- 只学过 Java 和 MySQL，课上学的，谈不上熟练。没学过别的框架和语言。
- 没有任何实习和兼职，没参加过比赛，没有证书，没有奖学金，没有 GitHub 和博客，没帮老师做过东西，没自学做过别的作品。
- 大二下学期的 Java 课程设计：和两个同学一起做了个学生成绩管理系统，你负责成绩录入和查询那部分，界面用 Java Swing，数据存在 MySQL，写了增删改查。碰到过中文乱码，后来把数据库和连接的编码都改成 UTF-8 解决了。没有任何数字结果。
- 大一在学校计算机协会，参与组织过一次给同学免费清灰、重装系统的电脑义诊活动，你负责现场登记和帮同学装系统。没统计过人数。
- 想找江城的 Java 开发校招岗位，2026年7月能到岗，薪资无所谓。`,
    style: `- 回答简短口语，一次只回答被问的那件事，像普通学生打字。
- 你觉得课程设计、社团活动都不算「项目」或「经历」：被笼统问到项目、实习、工作经历时，只说「没有」「没做过什么项目」。只有被明确问到课程设计/大作业时才讲课程设计；只有被明确问到社团/学生活动/志愿者时才讲义诊。`,
    expected: {
      basics: { name: "李明", phone: "13800001234", email: "liming@example.com", city: "江城" },
      education: [
        {
          school: "江城职业技术学院",
          degree: "associate",
          major: { $contains: ["软件技术"] },
          start: "2023-09",
          end: "2026-06",
        },
      ],
      projects: [
        {
          name: "成绩管理系统",
          role: { $contains: ["录入"] },
          techStack: ["Swing", "MySQL"],
          highlights: [{ $contains: ["录入"] }, { $contains: ["乱码"] }, { $contains: ["增删改查"] }],
        },
        { name: "义诊", role: { $contains: ["登记"] }, highlights: [{ $contains: ["系统"] }] },
      ],
      skills: [{ name: "Java" }, { name: "MySQL" }],
      intention: { roles: ["Java 开发"], cities: ["江城"], jobType: "campus", availableFrom: "2026-07" },
    },
  },
  {
    id: "intern",
    name: "王芳",
    title: "有实习的本科生",
    opening: "你好，我想做一份简历，准备秋招找后端开发",
    setting: `- 王芳，江城大学，计算机科学与技术专业，本科，2022年9月入学，2026年6月毕业，GPA 3.6（满分 4）。手机 13800002345，邮箱 wangfang@example.com，人在江城。
- 2025年7月到9月在江城数联信息做后端开发实习生，用 Go、MySQL 和 Redis。负责订单查询接口的优化：给热门查询加了 Redis 缓存，接口平均响应时间从 800ms 降到 200ms。还写了订单导出功能。
- 课程项目：和室友做过一个校园二手交易小程序，你负责后端接口，用 Node.js 和 MySQL。没有上线，没有数据。
- 技能：Go、Java、MySQL、Redis、Git；Java 是课上学的。
- 2024年拿过校级二等奖学金。没有其他奖项和证书。
- 想找江城或上海的后端开发校招岗位，2026年7月可以到岗。`,
    style: "- 问什么答什么，口语，适度详细，一次一般只讲被问的那件事。",
    expected: {
      basics: { name: "王芳", phone: "13800002345", email: "wangfang@example.com", city: "江城" },
      education: [
        {
          school: "江城大学",
          degree: "bachelor",
          major: { $contains: ["计算机"] },
          start: "2022-09",
          end: "2026-06",
          gpa: { $contains: ["3.6"] },
        },
      ],
      experiences: [
        {
          company: "江城数联信息",
          title: { $contains: ["后端"] },
          kind: "internship",
          start: "2025-07",
          end: "2025-09",
          techStack: ["Go", "MySQL", "Redis"],
          highlights: [{ $contains: ["缓存"] }, { $contains: ["800", "200"] }, { $contains: ["导出"] }],
        },
      ],
      projects: [{ name: "二手交易", role: { $contains: ["后端"] }, techStack: ["Node.js", "MySQL"] }],
      skills: [{ name: "Go" }, { name: "Java" }, { name: "MySQL" }, { name: "Redis" }, { name: "Git" }],
      awards: [{ name: "二等奖学金" }],
      intention: {
        roles: ["后端开发"],
        cities: ["江城", "上海"],
        jobType: "campus",
        availableFrom: "2026-07",
      },
    },
  },
  {
    id: "switcher",
    name: "赵磊",
    title: "转专业的",
    opening: "你好，我是学机械的，想转行做数据分析，能帮我弄份简历吗",
    setting: `- 赵磊，江城理工大学，机械设计制造及其自动化专业，本科，2021年9月入学，2025年6月毕业，已经毕业了。手机 13800003456，邮箱 zhaolei@example.com，人在江城。
- 想转行做数据分析。自学了大半年 Python（主要用 pandas）和 SQL。
- 自己做过一个分析项目：用 Python 和 pandas 分析学校食堂一学期的刷卡消费数据（学校公开的数据），做了按时段、按窗口的消费统计，发现午饭高峰在 11:40 到 12:10，写了一份报告交给后勤处。
- 2024年7月到8月在江城重工机械厂做生产实习，跟着师傅做零件尺寸检测，用 Excel 记录和汇总检测数据。
- 会 Excel、SolidWorks。没有证书和奖项。
- 想找江城的数据分析相关工作，没想好要求，薪资无所谓。`,
    style: `- 口语，回答不长。
- 对机械背景有点没底气，提到机械厂实习时会说「跟数据分析没啥关系」，但被问到会照实讲。`,
    expected: {
      basics: { name: "赵磊", phone: "13800003456", email: "zhaolei@example.com", city: "江城" },
      education: [
        {
          school: "江城理工大学",
          degree: "bachelor",
          major: { $contains: ["机械"] },
          start: "2021-09",
          end: "2025-06",
        },
      ],
      experiences: [
        {
          company: "江城重工",
          title: { $contains: ["实习"] },
          kind: "internship",
          start: "2024-07",
          end: "2024-08",
          techStack: ["Excel"],
          highlights: [{ $contains: ["检测"] }, { $contains: ["Excel"] }],
        },
      ],
      projects: [
        {
          name: "食堂",
          techStack: ["Python", "pandas"],
          highlights: [{ $contains: ["时段"] }, { $contains: ["11:40"] }, { $contains: ["报告"] }],
        },
      ],
      skills: [
        { name: "Python" },
        { name: "pandas" },
        { name: "SQL" },
        { name: "Excel" },
        { name: "SolidWorks" },
      ],
      intention: { roles: ["数据分析"], cities: ["江城"] },
    },
  },
  {
    id: "talker",
    name: "陈静",
    title: "一次说很多的",
    opening:
      "你好！我叫陈静，江城师范学院市场营销专业大四，想找新媒体运营的工作，我之前在江城晨报实习过，还在学生会宣传部当过部长，帮我做份简历吧",
    setting: `- 陈静，江城师范学院，市场营销专业，本科，2022年9月入学，2026年6月毕业。手机 13800004567，邮箱 chenjing@example.com，人在江城。
- 2025年3月到6月在江城晨报新媒体部实习，岗位是公众号运营编辑，写了 30 多篇推文，其中一篇阅读量 10 万+；还负责每周选题会的记录。
- 大二起在学院学生会宣传部，大三当部长，负责 2024 年迎新晚会的宣传，带 8 个干事做海报和推文。
- 会用剪映、Photoshop、秀米。
- 2024 年获得校级优秀学生干部。没有其他奖项。
- 想找江城的新媒体运营校招岗，2026年7月到岗。`,
    style: `- 话多。一被问到就把能想到的都倒出来，一条消息里常常同时讲两三件事（比如问实习时顺便把学生会和获奖也说了），但都必须是设定里的内容。
- 口语、热情。`,
    expected: {
      basics: { name: "陈静", phone: "13800004567", email: "chenjing@example.com", city: "江城" },
      education: [
        {
          school: "江城师范学院",
          degree: "bachelor",
          major: { $contains: ["市场营销"] },
          start: "2022-09",
          end: "2026-06",
        },
      ],
      experiences: [
        {
          company: "江城晨报",
          title: { $contains: ["编辑"] },
          kind: "internship",
          start: "2025-03",
          end: "2025-06",
          highlights: [{ $contains: ["30"] }, { $contains: ["10万"] }, { $contains: ["选题"] }],
        },
      ],
      projects: [
        {
          name: "宣传部",
          role: { $contains: ["部长"] },
          highlights: [{ $contains: ["迎新"] }, { $contains: ["8"] }],
        },
      ],
      skills: [{ name: "剪映" }, { name: "Photoshop" }, { name: "秀米" }],
      awards: [{ name: "优秀学生干部" }],
      intention: { roles: ["新媒体运营"], cities: ["江城"], jobType: "campus", availableFrom: "2026-07" },
    },
  },
  {
    id: "drifter",
    name: "孙浩",
    title: "爱跑题的",
    opening: "你好，帮我做个简历呗，想找电商的工作",
    setting: `- 孙浩，江城商贸职业学院，电子商务专业，大专，2023年9月入学，2026年6月毕业。手机 13800005678，邮箱 sunhao@example.com，人在江城。
- 2024年11月在江城好物电商（一家网店）做了一个月双十一客服兼职，每天回复顾客咨询、处理退换货。
- 实训课上和同学合开过一个淘宝店卖手机壳，你负责商品上架和写详情页，两个月卖了 50 多单。
- 会用 Excel、Photoshop 简单修图、千牛工作台。没有证书和奖项。
- 想找江城的电商运营校招岗位，2026年7月到岗。`,
    style: `- 口语，回答短。
- 爱跑题：大约每三四句里有一句不回答问题，而是说别的，比如问薪资（「电商运营一个月能拿多少啊」）、问岗位（「江城有啥电商的岗位吗」）、吐槽（「写简历好烦啊」）、问助手（「你是 AI 吗」）。被拉回来之后会正常回答。`,
    expected: {
      basics: { name: "孙浩", phone: "13800005678", email: "sunhao@example.com", city: "江城" },
      education: [
        {
          school: "江城商贸职业学院",
          degree: "associate",
          major: { $contains: ["电子商务"] },
          start: "2023-09",
          end: "2026-06",
        },
      ],
      experiences: [
        {
          company: "江城好物电商",
          title: { $contains: ["客服"] },
          kind: "parttime",
          start: "2024-11",
          highlights: [{ $contains: ["咨询"] }, { $contains: ["退换货"] }],
        },
      ],
      projects: [
        {
          name: "淘宝店",
          role: { $contains: ["上架"] },
          highlights: [{ $contains: ["上架"] }, { $contains: ["详情页"] }, { $contains: ["50"] }],
        },
      ],
      skills: [{ name: "Excel" }, { name: "Photoshop" }, { name: "千牛" }],
      intention: { roles: ["电商运营"], cities: ["江城"], jobType: "campus", availableFrom: "2026-07" },
    },
  },
];
