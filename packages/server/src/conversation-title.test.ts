import { createIntakeState } from "@talksume/agent";
import type { Gateway } from "@talksume/llm-gateway";
import { describe, expect, it } from "vitest";
import type { LoadedConversation } from "./conversation-store.ts";
import { gatewayTitler, sanitizeTitle, titleRound, titleTranscript } from "./conversation-title.ts";

describe("sanitizeTitle", () => {
  it("去掉引号、书名号和标点", () => {
    expect(sanitizeTitle("「李明的基本信息与项目」。")).toBe("李明的基本信息与项目");
    expect(sanitizeTitle('"后台开发岗，简历诊断！"')).toBe("后台开发岗简历诊断");
    expect(sanitizeTitle("标题：岗位推荐咨询")).toBe("岗位推荐咨询");
  });

  it("只取第一行非空内容", () => {
    expect(sanitizeTitle("\n岗位推荐咨询\n解释：用户在问岗位")).toBe("岗位推荐咨询");
  });

  it("超长截断到 16 个字", () => {
    expect([...(sanitizeTitle("一二三四五六七八九十一二三四五六七八九十") ?? "")]).toHaveLength(16);
  });

  it("过滤手机号和邮箱", () => {
    expect(sanitizeTitle("李明 13800000000 求职咨询")).toBe("李明求职咨询");
    expect(sanitizeTitle("李明 limingdemo@example.com 简历")).toBe("李明简历");
    expect(sanitizeTitle("李明+86 138-0000-0000简历")).toBe("李明简历");
  });

  it("保留英文词间空格和 C++、C# 这类写法", () => {
    expect(sanitizeTitle("Java Developer 简历")).toBe("Java Developer简历");
    expect(sanitizeTitle("C++ 开发简历")).toBe("C++开发简历");
  });

  it("清洗后太短或为空时返回 undefined", () => {
    expect(sanitizeTitle("")).toBeUndefined();
    expect(sanitizeTitle("「」。")).toBeUndefined();
    expect(sanitizeTitle("13800000000")).toBeUndefined();
  });
});

describe("titleTranscript", () => {
  it("跳过开场白，每条和总长都截断", () => {
    const text = titleTranscript([
      { role: "assistant", content: "你好，我是简聊助手" },
      { role: "user", content: "a".repeat(500) },
      { role: "assistant", content: "b".repeat(500) },
      ...Array.from({ length: 10 }, () => ({ role: "user" as const, content: "c".repeat(300) })),
    ]);
    expect(text).not.toContain("简聊助手");
    expect(text.split("\n")[0]).toBe(`用户：${"a".repeat(200)}`);
    expect(text.length).toBeLessThanOrEqual(1200);
  });
});

describe("gatewayTitler", () => {
  it("走 title 用途、关思考、少重试，第二次带上当前标题", async () => {
    const requests: Parameters<Gateway["complete"]>[0][] = [];
    const titler = gatewayTitler({
      complete: async (request) => {
        requests.push(request);
        return { text: "岗位推荐咨询", model: "m", message: {} as never };
      },
    });
    const turns = [{ role: "user" as const, content: "我叫李明" }];
    expect(await titler.generate(turns, {})).toBe("岗位推荐咨询");
    await titler.generate(turns, { current: "李明的基本信息" });
    expect(requests[0]).toMatchObject({ purpose: "title", thinking: false, maxRetries: 1 });
    expect(requests[0]?.prompt).toContain("我叫李明");
    expect(requests[0]?.prompt).not.toContain("当前标题");
    expect(requests[1]?.prompt).toContain("当前标题：李明的基本信息");
  });
});

describe("titleRound", () => {
  const loaded = (roles: ("user" | "assistant")[], before: number): LoadedConversation => {
    const state = createIntakeState({
      history: roles.map((role, i) => ({ id: `t${i}`, role, content: "x" })),
    });
    return {
      state,
      title: null,
      titleSource: "auto",
      snapshot: { profile: state.profile, facts: new Map(), historyLength: before },
    };
  };

  it("第 1 轮和第 3 轮触发，其他轮不触发", () => {
    expect(titleRound(loaded(["assistant", "user", "assistant"], 1))).toBe(1);
    expect(titleRound(loaded(["assistant", "user", "assistant", "user", "assistant"], 3))).toBeUndefined();
    expect(
      titleRound(loaded(["assistant", "user", "assistant", "user", "assistant", "user", "assistant"], 5)),
    ).toBe(3);
  });

  it("这一轮没有新的用户消息（比如处理待确认项）时不触发", () => {
    expect(titleRound(loaded(["assistant", "user", "assistant", "assistant"], 3))).toBeUndefined();
  });
});
