import type { Job } from "@talksume/core";

export type Role = "tech" | "product" | "design" | "ops" | "other";

const TECH =
  /工程师|开发|算法|研发|测试|架构|运维|后端|后台|前端|客户端|服务端|数据科学|数据分析|大模型|AI|安全|引擎|程序|SRE|QA|Java|Python/i;
const DESIGN = /设计|美术|原画|UI|UX|视觉|动效|交互|特效|建模|模型|动画|绘/i;
const PRODUCT = /产品|策划|PM|项目管理/i;
const OPS = /运营|营销|市场|内容|商务|增长|电商|品牌|社区|销售|客服|采购|用户研究/;

/** 仅按标题判断，先技术后设计，避免"系统设计工程师"一类被误归设计。 */
export function classifyRole(job: Pick<Job, "title">): Role {
  const t = job.title;
  if (TECH.test(t)) return "tech";
  if (DESIGN.test(t)) return "design";
  if (PRODUCT.test(t)) return "product";
  if (OPS.test(t)) return "ops";
  return "other";
}
