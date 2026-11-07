import type { InterviewQuestion } from "@talksume/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Question } from "./PrepList.tsx";

const question: InterviewQuestion = {
  id: "q14",
  kind: "motivation",
  question: "你找实习时对城市有偏好，能说说你的考虑和之后的职业规划吗？",
  focus: "城市选择和职业规划",
  approach: ["先给结论", "讲清原因", "落到这个岗位"],
  source: {},
  answerPoints: [{ text: "可以接受杭州或上海", quote: "杭州或上海都行" }],
  missing: "为什么是这两个城市？毕业后想往哪个方向发展？你还没说过，别临场编。",
  risks: [],
};

const render = (q: InterviewQuestion) => renderToStaticMarkup(<Question q={q} index={0} />);

describe("PrepList 题目卡片", () => {
  it("按怎么答、你能用的、面试前要想好排列，原话收在出处里", () => {
    const html = render(question);
    expect(html).toContain("怎么答");
    expect(html).toContain("你能用的");
    expect(html).toContain("面试前要想好");
    expect(html.indexOf("怎么答")).toBeLessThan(html.indexOf("你能用的"));
    expect(html.indexOf("你能用的")).toBeLessThan(html.indexOf("面试前要想好"));
    expect(html).not.toContain("你的原话");
    expect(html).toContain("<summary>出处</summary>");
    expect(html.indexOf("杭州或上海都行")).toBeGreaterThan(html.indexOf("<summary>出处</summary>"));
  });

  it("强于原话的风险仍然直接展示原话", () => {
    const html = render({
      ...question,
      approach: [],
      answerPoints: [],
      missing: undefined,
      risks: [
        {
          kind: "stronger_than_quote",
          terms: ["主导"],
          note: "简历写了「主导」，你原话里没有这个说法（你原话是「我参与了接口开发」）。",
        },
      ],
    });
    expect(html).toContain("我参与了接口开发");
  });

  it("旧题单没有 approach 时不显示怎么答", () => {
    const { approach: _ignored, ...legacy } = question;
    const html = render(legacy as InterviewQuestion);
    expect(html).not.toContain("怎么答");
    expect(html).toContain("你能用的");
  });
});
