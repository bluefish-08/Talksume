import type { Gateway } from "@talksume/llm-gateway";
import { describe, expect, it } from "vitest";
import { gatewaySummarizer, SUMMARY_LIMIT, transcriptPrompt } from "./conversation-memory.ts";

type Req = Parameters<Gateway["completeStructured"]>[0];

describe("会话摘要", () => {
  it("走 memory 用途、关思考，摘要截到上限", async () => {
    const seen: Req[] = [];
    const summarize = gatewaySummarizer({
      completeStructured: (async (req: Req) => {
        seen.push(req);
        return {
          value: req.validate({ summary: "聊".repeat(300), topic: "江城闲置项目" }),
          text: "",
          model: "m",
        };
      }) as Gateway["completeStructured"],
    });
    const out = await summarize([
      { role: "assistant", content: "怎么称呼你？" },
      { role: "user", content: "我叫李明，回头再补实习" },
      { role: "tool", content: "ignored" },
    ]);
    expect(out.summary).toHaveLength(SUMMARY_LIMIT);
    expect(out.topic).toBe("江城闲置项目");
    expect(seen[0]).toMatchObject({ purpose: "memory", thinking: false });
    expect(seen[0]?.prompt).toBe("助手：怎么称呼你？\n用户：我叫李明，回头再补实习");
  });

  it("只取最近 40 条，每条截断", () => {
    const turns = Array.from({ length: 50 }, (_, i) => ({
      role: "user",
      content: `第${i}条${"字".repeat(400)}`,
    }));
    const lines = transcriptPrompt(turns).split("\n");
    expect(lines).toHaveLength(40);
    expect(lines[0]).toMatch(/^用户：第10条/);
    expect(lines[0]?.length).toBeLessThanOrEqual(303);
  });
});
