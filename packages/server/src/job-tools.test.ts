import { describe, expect, it } from "vitest";
import { reasonFromDims } from "./job-tools.ts";

describe("推荐理由", () => {
  it("用方向和命中的技能拼一句话，不带 JD 原文", () => {
    const reason = reasonFromDims({
      role: { score: 0.9, weight: 0.3, evidence: ["意向岗位「后端开发」与岗位名「后台开发」同属后端开发"] },
      skills: {
        score: 0.8,
        weight: 0.3,
        evidence: [
          "命中 Java：画像技能「Java」；JD「熟悉 Java」",
          "命中 C++/Go 任一：画像技能「Go」；JD「Go」",
        ],
      },
    });
    expect(reason).toBe("方向对口，技能命中 Java、C++/Go");
  });

  it("没有方向和技能证据时退回贡献最大的维度，去掉 JD 引文", () => {
    const reason = reasonFromDims({
      role: { score: 0.2, weight: 0.3, evidence: ["意向岗位「后端开发」与「游戏策划」没有明显关联"] },
      experience: { score: 0.5, weight: 0.25, evidence: ["项目与 JD 共有关键词：数值；JD「负责数值」"] },
    });
    expect(reason).toBe("项目与 JD 共有关键词：数值");
  });
});
