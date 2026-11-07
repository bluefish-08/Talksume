import { describe, expect, it } from "vitest";
import { changeMarkParts, PREVIEW_CSS, provenanceLine } from "./ResumePreview.tsx";

describe("定制版的纸面标记", () => {
  it("只有编号和左侧竖线，没有黄底和「已定制」角标", () => {
    const parts = changeMarkParts({ label: "要点措辞", number: 2, before: ["旧文案"] });
    expect(parts).toMatchObject({ className: "changed traceable", number: 2 });
    expect(parts.badge).toBeUndefined();
    expect(parts.className).not.toContain("new-tag");
    expect(PREVIEW_CSS).toContain(".resume .changed { border-left: 2px solid #2563eb;");
    expect(PREVIEW_CSS).not.toContain("#fdf6e3");
    expect(PREVIEW_CSS).not.toContain("#ecd28f");
    expect(PREVIEW_CSS).not.toContain("tailor-tag");
    expect(PREVIEW_CSS).not.toContain("已定制");
  });

  it("没有编号的改动不打编号点", () => {
    expect(changeMarkParts({ label: "摘要", before: ["旧摘要"] }).number).toBeUndefined();
  });
});

describe("原话浮层的出处", () => {
  it("轮次已知时写轮次，导入简历写来源", () => {
    expect(provenanceLine({ quote: "我会 Go", round: 2 })).toBe("依据：你在第 2 轮说的「我会 Go」");
    expect(provenanceLine({ quote: "李明，江城大学", fromResume: true })).toBe(
      "来自你导入的简历「李明，江城大学」",
    );
    expect(provenanceLine({ quote: "我会 Go" })).toBe("依据：你说的「我会 Go」");
  });

  it("浮层支持点击/聚焦，也有待确认和改这条的样式", () => {
    expect(PREVIEW_CSS).toContain(".traceable:focus > .pop");
    expect(PREVIEW_CSS).toContain(".traceable:focus-within > .pop");
    expect(PREVIEW_CSS).toContain(".pop-tag");
    expect(PREVIEW_CSS).toContain(".pop-edit");
  });
});
