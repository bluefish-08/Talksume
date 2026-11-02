import type { ResumeContent } from "@talksume/core";

const b = (text: string) => ({ text, factIds: [] as string[] });

// 虚构样例：计算机专业大三学生投递后端实习
export const sampleResume: ResumeContent = {
  basics: {
    name: "林知远",
    contacts: ["138-0000-0000", "linzhiyuan@example.com", "上海", "github.com/example-linzy"],
    summary:
      "计算机科学与技术专业大三在读，熟悉 Java / Go 后端开发与 MySQL、Redis，有两段后端实习经历，寻求 2027 届暑期后端开发实习。",
  },
  sections: [
    {
      kind: "education",
      title: "教育背景",
      items: [
        {
          heading: "华东示范大学",
          subheading: "计算机科学与技术 本科",
          period: "2023.09 – 2027.06",
          bullets: [
            b("GPA 3.8/4.0（专业前 10%），核心课程：数据结构、操作系统、计算机网络、数据库原理、分布式系统"),
            b("2024、2025 学年连续获校级一等奖学金"),
          ],
        },
      ],
    },
    {
      kind: "experiences",
      title: "实习经历",
      items: [
        {
          heading: "星云科技",
          subheading: "后端开发实习生 · 订单平台组",
          period: "2025.07 – 2025.09",
          bullets: [
            b("负责订单查询接口的性能优化，引入 Redis 二级缓存并重构慢 SQL，P99 延迟由 480ms 降至 120ms"),
            b(
              "基于 Kafka 实现订单状态变更的异步通知，替换原有轮询方案，日均处理消息 200 万条，消息丢失率为 0",
            ),
            b("编写 15 个核心接口的单元与集成测试，将模块测试覆盖率从 42% 提升至 78%"),
          ],
        },
        {
          heading: "云帆网络",
          subheading: "Go 开发实习生 · 基础服务组",
          period: "2025.01 – 2025.03",
          bullets: [
            b("参与内部配置中心的 Go 服务开发，实现配置灰度发布与版本回滚功能，支持 30+ 业务方接入"),
            b("使用 pprof 定位 goroutine 泄漏问题并修复，服务内存占用下降约 35%"),
          ],
        },
      ],
    },
    {
      kind: "projects",
      title: "项目经历",
      items: [
        {
          heading: "轻量级分布式 KV 存储",
          subheading: "个人项目 · Go",
          period: "2025.03 – 2025.06",
          bullets: [
            b("基于 Raft 协议实现多副本强一致 KV 存储，支持领导者选举、日志复制与快照压缩"),
            b("使用 Jepsen 风格的故障注入脚本验证网络分区与节点宕机场景下的线性一致性"),
          ],
        },
        {
          heading: "校园二手交易平台",
          subheading: "课程设计 · Java / Spring Boot",
          period: "2024.09 – 2024.12",
          bullets: [
            b("团队 4 人，负责用户、商品与订单模块的后端设计，使用 Redis 分布式锁解决超卖问题"),
            b("基于 Elasticsearch 实现商品全文检索，并接入 JWT 完成无状态登录鉴权，项目获课程设计满分"),
          ],
        },
      ],
    },
    {
      kind: "skills",
      title: "专业技能",
      items: [
        {
          heading: "编程语言",
          bullets: [b("熟练使用 Java、Go；了解 Python、C++；熟悉常用数据结构与算法，LeetCode 刷题 400+")],
        },
        {
          heading: "后端技术",
          bullets: [
            b(
              "熟悉 Spring Boot、MySQL（索引、事务、MVCC）、Redis、Kafka；了解 Docker、Linux 常用运维与排障命令",
            ),
          ],
        },
      ],
    },
    {
      kind: "awards",
      title: "获奖荣誉",
      items: [
        { heading: "ACM-ICPC 亚洲区域赛（华东）铜牌", period: "2024.11", bullets: [] },
        { heading: "全国大学生计算机设计大赛 省级二等奖", period: "2025.05", bullets: [] },
      ],
    },
  ],
};
