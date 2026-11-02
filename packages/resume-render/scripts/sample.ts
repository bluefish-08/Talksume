import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RESUME_TEMPLATES, type ResumeAccent, type ResumeContent } from "@talksume/core";
import { close, renderDocx, renderHtml, renderPdf, sampleResume } from "../src/index.ts";

const b = (text: string) => ({ text, factIds: [] as string[] });

// 虚构样例：软件工程大三学生投递前端实习，内容偏少，用来看各模板的留白
const liMing: ResumeContent = {
  basics: {
    name: "李明",
    contacts: ["139-0000-0000", "liming@example.com", "江城"],
    summary: "软件工程专业大三，做过校园二手交易小程序「江城闲置」并上线运营，寻求前端开发实习。",
  },
  sections: [
    {
      kind: "education",
      title: "教育背景",
      items: [
        {
          heading: "江城大学",
          subheading: "软件工程 本科",
          period: "2023.09 – 2027.06",
          bullets: [b("GPA 3.6/4.0，核心课程：Web 前端开发、数据结构、软件工程、数据库系统")],
        },
      ],
    },
    {
      kind: "projects",
      title: "项目经历",
      items: [
        {
          heading: "江城闲置 · 校园二手交易小程序",
          subheading: "负责人 · 微信小程序 / TypeScript / 云开发",
          period: "2024.10 – 2025.06",
          bullets: [
            b("发现毕业季闲置物品难以流转，带领 4 人小组从零搭建校内二手交易小程序"),
            b("负责商品发布、搜索与私信模块，实现图片压缩上传与列表虚拟滚动，首屏加载缩短到 1.2 秒"),
            b("上线一学期累计注册 3200 人，成交 1800 余单，获校创新创业项目立项"),
          ],
        },
        {
          heading: "课程表助手",
          subheading: "个人项目 · Vue 3",
          period: "2024.03 – 2024.05",
          bullets: [b("解析教务系统导出的课表文件，生成周视图并支持上课提醒，在班级内 60 余人使用")],
        },
      ],
    },
    {
      kind: "experiences",
      title: "校园经历",
      items: [
        {
          heading: "江城大学学生会",
          subheading: "技术部副部长",
          period: "2024.09 – 2025.06",
          bullets: [b("维护学生会活动报名系统，组织 3 次前端入门分享，覆盖新成员 40 余人")],
        },
      ],
    },
    {
      kind: "skills",
      title: "专业技能",
      items: [
        { heading: "熟悉", bullets: [b("TypeScript、Vue 3、微信小程序、HTML/CSS")] },
        { heading: "了解", bullets: [b("React、Node.js、MySQL、Git")] },
      ],
    },
    {
      kind: "awards",
      title: "获奖荣誉",
      items: [
        { heading: "江城大学创新创业大赛 一等奖", period: "2025.05", bullets: [] },
        { heading: "校级二等奖学金", period: "2024.10", bullets: [] },
      ],
    },
  ],
};

const outDir = resolve(process.argv[2] ?? fileURLToPath(new URL("../out/", import.meta.url)));
const accent = (process.argv[3] ?? "blue") as ResumeAccent;
await mkdir(outDir, { recursive: true });

try {
  for (const [key, content] of [
    ["sample", sampleResume],
    ["liming", liMing],
  ] as const) {
    for (const template of RESUME_TEMPLATES) {
      const base = `${outDir}/${key}-${template}`;
      await writeFile(`${base}.html`, renderHtml(content, { template, accent }));
      await writeFile(`${base}.pdf`, await renderPdf(content, { template, accent }));
      await writeFile(`${base}.docx`, await renderDocx(content, { template, accent }));
    }
  }
  console.log(`已输出到 ${outDir}`);
} finally {
  await close();
}
