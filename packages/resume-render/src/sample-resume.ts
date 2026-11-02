import { Profile, profileToResume, type ResumeContent } from "@talksume/core";

// 虚构样例：江城大学 2026 届计算机本科生投递后端校招；人名、公司、链接均为编造
export const sampleProfile: Profile = Profile.parse({
  basics: {
    name: "林知远",
    phone: "138-0000-0000",
    email: "linzhiyuan@example.com",
    city: "江城",
    links: [
      { label: "GitHub", url: "https://github.com/example-linzy" },
      { label: "博客", url: "https://linzy.example.com" },
    ],
    languages: ["CET-6 586"],
  },
  intention: {
    roles: ["后端开发工程师"],
    cities: ["上海", "杭州"],
    jobType: "campus",
    availableFrom: "2026-07",
  },
  education: [
    {
      id: "edu_1",
      school: "江城大学",
      degree: "bachelor",
      major: "计算机科学与技术",
      city: "江城",
      gpa: "3.82/4.0",
      rank: "专业前 5%",
      courses: ["数据结构", "操作系统", "计算机网络", "数据库系统", "分布式系统", "编译原理"],
      honors: ["国家奖学金（2024）", "校一等奖学金（2023、2025）", "校优秀学生干部"],
      start: "2022-09",
      end: "2026-06",
    },
  ],
  experiences: [
    {
      id: "exp_1",
      kind: "internship",
      company: "星云科技",
      department: "交易平台部",
      title: "后端开发实习生",
      city: "上海",
      techStack: ["Java", "Spring Boot", "MySQL", "Redis", "Kafka"],
      start: "2025-06",
      end: "2025-09",
      highlights: [
        {
          title: "订单查询链路优化",
          detail:
            "引入 Redis 二级缓存并重写 3 条慢 SQL，订单详情接口 P99 延迟从 480ms 降至 120ms，数据库读压力下降 65%",
        },
        {
          title: "状态变更异步化",
          detail:
            "基于 Kafka 将订单状态通知由定时轮询改为事件驱动，日均处理消息 200 万条，下游感知延迟从分钟级降到 2 秒内",
        },
        {
          title: "幂等与对账",
          detail: "设计基于唯一请求号的幂等表和 T+1 对账任务，上线后重复扣款工单清零，对账差错率降至 0.01%",
        },
        {
          title: "压测与容量评估",
          detail: "用 JMeter 搭建大促压测脚本，定位连接池瓶颈并调整参数，单机 QPS 从 1200 提升到 3500",
        },
      ],
    },
    {
      id: "exp_2",
      kind: "internship",
      company: "青禾数据",
      department: "基础架构组",
      title: "Go 开发实习生",
      city: "杭州",
      techStack: ["Go", "gRPC", "etcd", "Prometheus"],
      start: "2024-12",
      end: "2025-03",
      highlights: [
        {
          title: "配置中心客户端",
          detail:
            "基于 etcd Watch 实现配置热更新 SDK，接入 30 余个内部服务，配置生效时间从 5 分钟缩短到 3 秒",
        },
        {
          title: "服务可观测性",
          detail: "为 gRPC 网关补齐 Prometheus 指标与链路追踪，故障定位平均耗时减少 40%",
        },
        {
          title: "单元测试治理",
          detail: "为核心模块补写表驱动测试，覆盖率从 38% 提升到 81%，并接入 CI 门禁",
        },
      ],
    },
  ],
  projects: [
    {
      id: "prj_1",
      name: "江城闲置 · 校园二手交易平台",
      role: "后端负责人",
      techStack: ["Spring Boot", "MySQL", "Redis", "Elasticsearch", "Docker"],
      start: "2024-03",
      end: "2024-10",
      highlights: [
        {
          title: "交易核心链路",
          detail: "设计商品、订单、私信三大模块共 40 余个接口，带领 4 人小组两个月完成上线",
        },
        {
          title: "搜索与推荐",
          detail: "用 Elasticsearch 实现商品全文检索与按校区过滤，搜索响应从 800ms 降至 90ms",
        },
        { title: "热点缓存", detail: "对首页与热门商品做 Redis 缓存和库存预扣，高峰期接口成功率保持 99.9%" },
        { title: "运营成果", detail: "上线一学期注册用户 3200 人，累计成交 1800 余单，获校创新创业项目立项" },
      ],
    },
    {
      id: "prj_2",
      name: "MiniKV · 基于 Raft 的分布式 KV 存储",
      role: "个人项目",
      techStack: ["Go", "Raft", "LSM-Tree"],
      start: "2023-10",
      end: "2024-01",
      highlights: [
        { title: "一致性", detail: "按论文实现 Raft 选主、日志复制与快照，通过 MIT 6.824 全部测试用例" },
        { title: "存储引擎", detail: "实现基于 LSM-Tree 的存储层与布隆过滤器，随机读放大降低 60%" },
        { title: "性能", detail: "3 节点集群写入吞吐达到 1.2 万 QPS，开源后获 150+ Star" },
      ],
    },
  ],
  skills: [
    { id: "s1", category: "编程语言", name: "Java", level: "proficient" },
    { id: "s2", category: "编程语言", name: "Go", level: "proficient" },
    { id: "s3", category: "编程语言", name: "Python", level: "familiar" },
    { id: "s4", category: "框架与中间件", name: "Spring Boot" },
    { id: "s5", category: "框架与中间件", name: "MyBatis" },
    { id: "s6", category: "框架与中间件", name: "Kafka" },
    { id: "s7", category: "框架与中间件", name: "gRPC" },
    { id: "s8", category: "数据库", name: "MySQL（索引、事务、调优）" },
    { id: "s9", category: "数据库", name: "Redis" },
    { id: "s10", category: "数据库", name: "Elasticsearch" },
    { id: "s11", category: "工具与平台", name: "Linux" },
    { id: "s12", category: "工具与平台", name: "Docker" },
    { id: "s13", category: "工具与平台", name: "Kubernetes" },
    { id: "s14", category: "工具与平台", name: "Git" },
    { id: "s15", category: "AI 相关", name: "LangChain" },
    { id: "s16", category: "AI 相关", name: "RAG 检索增强" },
  ],
  awards: [
    { id: "a1", name: "ACM-ICPC 亚洲区域赛 铜奖", date: "2024-11" },
    { id: "a2", name: "全国大学生计算机设计大赛 省级一等奖", date: "2024-06" },
  ],
});

export const sampleResume: ResumeContent = profileToResume(sampleProfile);

// 内容很少的虚构样例：只有教育和一个 STAR 写法的项目，用来检查留白
export const sparseProfile: Profile = Profile.parse({
  basics: { name: "周以安", phone: "139-0000-0000", email: "zhouyian@example.com" },
  intention: { roles: ["Java 开发"], jobType: "internship" },
  education: [
    { id: "e1", school: "江城大学", degree: "bachelor", major: "软件工程", start: "2023-09", end: "2027-06" },
  ],
  projects: [
    {
      id: "p1",
      name: "图书借阅小程序",
      role: "课程设计",
      techStack: ["Spring Boot", "MySQL"],
      situation: "图书馆纸质登记效率低",
      task: "为学院图书角做一个借阅系统",
      action: "负责后端接口与数据库设计，实现借还书和逾期提醒",
      result: "在学院内试用，登记了 600 余本图书",
      start: "2024-09",
      end: "2024-12",
    },
  ],
});

export const sparseResume: ResumeContent = profileToResume(sparseProfile);
