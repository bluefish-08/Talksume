import { Profile } from "@talksume/core";

export interface EvalCase {
  id: string;
  describe: string;
  profile: Profile;
  /** jobId -> [相关度 0/1/2, 标注理由]；未列出的池内岗位一律为 0。 */
  labels: Record<string, [0 | 1 | 2, string]>;
}

/** 评测池：从种子库里按岗位方向挑出的 30 条，每个画像对这 30 条逐条标注。 */
export const POOL = [
  "tencent_campus:1200791473415778304",
  "meituan:4208447290",
  "netease:70839",
  "meituan:4697280304",
  "tencent_campus:1282707383965295616",
  "netease:79446",
  "tencent_campus:1210569901664899072",
  "meituan:3763421415",
  "tencent_campus:1211674462290972672",
  "tencent_campus:1200889496565214208",
  "mihoyo:9119",
  "tencent_campus:1282707395466077186",
  "mihoyo:9560",
  "meituan:4832298989",
  "meituan:4888248664",
  "mihoyo:9001",
  "tencent_campus:1211674464354570240",
  "meituan:4402739791",
  "tencent_campus:1188988696721092608",
  "netease:59824",
  "tencent_campus:1212816229455368192",
  "meituan:4243191115",
  "meituan:4887607615",
  "netease:79658",
  "tencent_campus:1177660287760077824",
  "netease:68492",
  "mihoyo:9215",
  "tencent_campus:1177660287764272129",
  "meituan:4830883121",
  "meituan:4718078089",
];

const edu = (degree: "bachelor" | "master", major: string, school = "某双一流高校") => ({
  id: "e1",
  school,
  degree,
  major,
});

const base = (p: unknown) => Profile.parse(p);

export const CASES: EvalCase[] = [
  {
    id: "backend-undergrad",
    describe: "计算机本科，后端方向，不限实习/校招，上海或北京",
    profile: base({
      education: [edu("bachelor", "计算机科学与技术")],
      skills: ["Java", "Golang", "MySQL", "Redis", "Linux", "数据结构"].map((name, i) => ({
        id: `s${i}`,
        name,
      })),
      projects: [
        {
          id: "p1",
          name: "秒杀系统",
          role: "后端开发",
          techStack: ["Spring Boot", "Redis", "Kafka"],
          action: "设计库存预扣与异步下单链路，使用消息队列削峰，压测 QPS 提升 3 倍",
        },
        {
          id: "p2",
          name: "校园二手交易平台",
          role: "后端",
          techStack: ["Spring Boot", "MySQL"],
          action: "负责订单与支付服务开发",
        },
      ],
      intention: { roles: ["后端开发工程师"], cities: ["上海", "北京"] },
    }),
    labels: {
      "tencent_campus:1200791473415778304": [2, "后台开发实习，Java/Go/网络/数据库要求与画像一致"],
      "tencent_campus:1282707383965295616": [2, "后台开发校招，同上"],
      "meituan:4697280304": [2, "AI 后端开发，本质是后端服务开发，技术栈匹配"],
      "mihoyo:9560": [1, "Agent 平台服务端开发，后端能力可迁移，但需要 Agent 知识"],
      "meituan:4208447290": [1, "数据开发（数仓），要求 SQL/Java，但偏数据工程"],
      "tencent_campus:1210569901664899072": [1, "测试开发，需要编码但职能是测试"],
    },
  },
  {
    id: "algo-master",
    describe: "人工智能硕士，大模型/推荐算法，不限类型，北京/上海/深圳",
    profile: base({
      education: [edu("master", "人工智能")],
      skills: ["Python", "PyTorch", "NLP", "Transformer", "大模型", "RAG", "机器学习"].map((name, i) => ({
        id: `s${i}`,
        name,
      })),
      projects: [
        {
          id: "p1",
          name: "基于大模型的检索增强问答系统",
          role: "算法",
          techStack: ["PyTorch", "RAG", "Transformer"],
          action: "微调语言模型并设计召回与重排流程，答案准确率提升 12%",
        },
        {
          id: "p2",
          name: "信息流点击率预估",
          role: "算法",
          techStack: ["PyTorch", "推荐系统"],
          action: "实现召回与排序模型，离线 AUC 提升 1.5 个点",
        },
      ],
      intention: { roles: ["算法工程师", "大模型算法"], cities: ["北京", "上海", "深圳"] },
    }),
    labels: {
      "tencent_campus:1282707395466077186": [2, "AI 算法工程，微调/检索增强与画像一致"],
      "mihoyo:9119": [2, "推荐算法工程师，与推荐项目一致"],
      "meituan:3763421415": [2, "大模型算法实习，方向一致"],
      "tencent_campus:1211674462290972672": [2, "推荐算法实习，与推荐项目一致"],
      "tencent_campus:1200889496565214208": [2, "NLP 算法实习，与 NLP/大模型技能一致"],
      "mihoyo:9560": [1, "Agent 开发，需大模型知识但偏工程"],
      "meituan:4697280304": [1, "AI 后端，涉及 RAG 集成但偏后端工程"],
      "tencent_campus:1211674464354570240": [1, "数据科学方向算法，机器学习相关"],
    },
  },
  {
    id: "product-ops-undergrad",
    describe: "市场营销本科，产品运营/新媒体，不限类型，北京/上海",
    profile: base({
      education: [edu("bachelor", "市场营销")],
      skills: ["数据分析", "Excel", "Axure", "文案", "PPT", "SQL"].map((name, i) => ({ id: `s${i}`, name })),
      experiences: [
        {
          id: "x1",
          kind: "internship",
          company: "某互联网公司",
          title: "新媒体运营实习生",
          bullets: ["负责公众号与社群内容运营，周活跃提升 20%", "用 Excel 做用户增长数据分析"],
        },
      ],
      projects: [
        {
          id: "p1",
          name: "校园公众号运营",
          role: "负责人",
          techStack: [],
          action: "策划选题并分析阅读数据，粉丝增长到 2 万",
        },
      ],
      intention: { roles: ["产品运营", "新媒体运营"], cities: ["北京", "上海"] },
    }),
    labels: {
      "meituan:4402739791": [2, "产品运营实习，与运营经历直接对口"],
      "meituan:4243191115": [2, "产品运营实习，同上"],
      "tencent_campus:1212816229455368192": [2, "产品运营，同上"],
      "meituan:4887607615": [2, "市场营销实习，专业与新媒体经历对口"],
      "tencent_campus:1188988696721092608": [1, "产品策划，相邻的产品方向"],
      "mihoyo:9001": [1, "数据产品经理，相邻且需要数据分析"],
      "meituan:4832298989": [1, "数据分析实习，数据分析技能可用但职能不同"],
      "meituan:4888248664": [1, "商业分析实习，同上"],
    },
  },
  {
    id: "visual-design-intern",
    describe: "视觉传达设计本科，视觉/UI 设计实习，上海/深圳",
    profile: base({
      education: [edu("bachelor", "视觉传达设计")],
      skills: ["Figma", "Photoshop", "Illustrator", "After Effects", "视觉设计"].map((name, i) => ({
        id: `s${i}`,
        name,
      })),
      experiences: [
        {
          id: "x1",
          kind: "internship",
          company: "某设计工作室",
          title: "视觉设计实习生",
          bullets: ["负责活动海报与品牌物料设计", "使用 Figma 输出 App 界面稿"],
        },
      ],
      projects: [
        {
          id: "p1",
          name: "品牌 VI 与 App 界面设计",
          role: "设计",
          techStack: ["Figma", "Illustrator"],
          action: "完成品牌视觉规范与界面设计",
        },
      ],
      intention: { roles: ["视觉设计", "UI设计"], cities: ["上海", "深圳"], jobType: "internship" },
    }),
    labels: {
      "tencent_campus:1177660287760077824": [2, "视觉设计实习，深圳，与视觉设计经历一致"],
      "mihoyo:9215": [2, "游戏 UI 实习，上海，UI 方向一致"],
      "meituan:4718078089": [2, "平面设计实习，深圳，视觉物料设计一致"],
      "tencent_campus:1177660287764272129": [1, "交互设计，相邻设计方向，Figma 可用"],
      "meituan:4830883121": [1, "UX 设计，相邻设计方向"],
    },
  },
  {
    id: "data-analyst-intern",
    describe: "统计学本科，数据分析实习，仅北京",
    profile: base({
      education: [edu("bachelor", "统计学")],
      skills: ["SQL", "Python", "Excel", "Tableau", "统计学", "A/B测试"].map((name, i) => ({
        id: `s${i}`,
        name,
      })),
      experiences: [
        {
          id: "x1",
          kind: "internship",
          company: "某电商公司",
          title: "数据分析实习生",
          bullets: ["用 SQL 提取用户行为数据并搭建留存分析看板", "设计 A/B 实验评估活动效果"],
        },
      ],
      projects: [
        {
          id: "p1",
          name: "用户留存分析",
          role: "分析",
          techStack: ["Python", "SQL"],
          action: "完成用户分层与留存影响因素回归分析",
        },
      ],
      intention: { roles: ["数据分析师"], cities: ["北京"], jobType: "internship" },
    }),
    labels: {
      "meituan:4832298989": [2, "数据分析实习，北京，指标体系与用户分析对口"],
      "meituan:4888248664": [2, "商业分析实习，北京，用户数据挖掘与统计分析对口"],
      "meituan:4208447290": [1, "数据开发，北京，SQL/数仓相关但偏开发"],
      "tencent_campus:1211674464354570240": [1, "算法-数据科学方向，北京，需要机器学习，偏算法"],
    },
  },
];
