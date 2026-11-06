import type { ResumeContent } from "@talksume/core";

export const JOB = {
  company: "示例科技",
  title: "后端开发实习生",
  jdText:
    "岗位职责：参与后端服务和接口开发，配合团队完成需求。任职要求：熟悉 Java 或 Go；了解 MySQL、Redis；有良好的沟通能力和学习能力；有项目或实习经历者优先。",
  tags: ["Java", "MySQL", "Redis"],
};

/** 用户从没说过 Redis、数字和「主导」，简历里却写了。 */
export const FACTS = [
  { id: "f1", quote: "我在星河科技实习的时候参与了订单查询接口的开发，用的是 Java 和 MySQL" },
  { id: "f2", quote: "我还给接口写过文档，同事反馈说比较清楚" },
  { id: "f3", quote: "我们小组一起做了一个校园二手书小程序，我负责后端的几个接口，是用 Go 写的" },
  { id: "f4", quote: "我在校科协待过一年，帮着办过两次讲座" },
];

export const RESUME: ResumeContent = {
  basics: { name: "李明", contacts: [] },
  sections: [
    {
      kind: "experiences",
      title: "实习经历",
      items: [
        {
          heading: "星河科技",
          subheading: "后端开发实习生",
          techStack: ["Java", "MySQL"],
          bullets: [
            { text: "主导订单查询接口开发，接口响应时间提升 40%", factIds: ["f1"] },
            { text: "编写接口文档，获团队好评", factIds: ["f2"] },
          ],
        },
      ],
    },
    {
      kind: "projects",
      title: "项目经历",
      items: [
        {
          heading: "校园二手书小程序",
          techStack: ["Go"],
          bullets: [{ text: "负责后端接口开发", factIds: ["f3"] }],
        },
      ],
    },
    {
      kind: "campus",
      title: "校园经历",
      items: [
        {
          heading: "校科协",
          bullets: [{ text: "组织两场技术讲座，累计 200 人参加", factIds: ["f4"] }],
        },
      ],
    },
  ],
};
