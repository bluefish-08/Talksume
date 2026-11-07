import { describe, expect, it } from "vitest";
import { cardStatus, levelName, placeTailorCards } from "./tailorCards.ts";
import type { ChatMessage, TailorCard } from "./types.ts";

const card = (jobId: string, changes = 2): TailorCard => ({
  jobId,
  company: "美团",
  title: "后端开发工程师（实习）",
  level: "light",
  changes,
  rejected: 0,
});

const message = (key: string, tailor?: TailorCard): Pick<ChatMessage, "key" | "tailor"> => ({
  key,
  ...(tailor && { tailor }),
});

describe("定制卡片在同一场对话里的位置", () => {
  it("同一岗位后面又出了新版时，旧的收成一行", () => {
    const placed = placeTailorCards([
      message("u1"),
      message("a1", card("demo:mt1", 3)),
      message("a2", card("demo:other")),
      message("a3", card("demo:mt1", 2)),
    ]);
    expect(placed.get("a1")).toMatchObject({ superseded: true });
    expect(placed.get("a2")).toMatchObject({ superseded: false });
    expect(placed.get("a3")).toMatchObject({ superseded: false });
    expect(placed.get("a1")?.card.changes).toBe(3);
  });

  it("没有新版时不折叠，跨岗位互不影响", () => {
    const placed = placeTailorCards([message("a1", card("demo:mt1")), message("a2", card("demo:other"))]);
    expect(placed.get("a1")?.superseded).toBe(false);
    expect(placed.get("a2")?.superseded).toBe(false);
  });
});

describe("卡片状态跟服务端一致", () => {
  it("已采用且选中了改动才算已采用", () => {
    expect(cardStatus(undefined)).toBe("draft");
    expect(
      cardStatus({
        adopted: null,
        selected: [],
      } as never),
    ).toBe("draft");
    expect(
      cardStatus({
        adopted: { resumeVersionId: "v1", adoptedAt: "2026-10-01T00:00:00.000Z" },
        selected: ["summary"],
      } as never),
    ).toBe("adopted");
    expect(
      cardStatus({
        adopted: { resumeVersionId: "v1", adoptedAt: "2026-10-01T00:00:00.000Z" },
        selected: [],
      } as never),
    ).toBe("draft");
  });

  it("档位显示中文名", () => {
    expect(levelName("light")).toBe("微调");
    expect(levelName("keywords")).toBe("嵌入关键词");
    expect(levelName("deep")).toBe("深度改写");
    expect(levelName(undefined)).toBe("");
  });
});
