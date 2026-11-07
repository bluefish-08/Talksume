import { DEFAULT_RESUME_STYLE, polishSourceHash } from "@talksume/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Completeness, ResumeContent } from "../../api/types.ts";
import { ToastProvider } from "../../components/Toast.tsx";
import { shouldClosePolishPreview } from "../resume/PolishPreview.tsx";
import { type PolishState, polishKey } from "../resume/polishQueries.ts";
import { resumeDesignsKey, resumeStyleKey } from "../resume/queries.ts";
import { ResumePane } from "./ResumePane.tsx";

vi.mock("../resume/ResumePreview.tsx", () => ({
  ResumePreview: ({
    resume,
    changeMarks,
  }: {
    resume: { sections: { items: { bullets: { text: string }[] }[] }[] };
    changeMarks?: { bullets?: ReadonlyMap<string, unknown> } | undefined;
  }) => (
    <div
      data-testid="preview"
      data-bullets={JSON.stringify([...(changeMarks?.bullets ?? [])])}
      data-text={resume.sections[0]?.items[0]?.bullets.map((b) => b.text).join("|")}
    />
  ),
}));

const resume: ResumeContent = {
  basics: { name: "李明", contacts: [] },
  sections: [
    {
      kind: "experiences",
      title: "实习经历",
      items: [{ heading: "云图数据", bullets: [{ text: "原始二", factIds: [] }] }],
    },
  ],
};

const completeness: Completeness = { score: 0.79, sections: [], missing: [] };

const polishState: PolishState = {
  available: true,
  entries: [
    {
      itemKey: "experiences:云图数据",
      sectionKind: "experiences",
      heading: "云图数据",
      slot: 0,
      text: "原始一",
      sourceHash: polishSourceHash("原始一"),
      factIds: [],
      stale: false,
      polish: {
        id: "p1",
        suggestion: "采用一",
        accepted: "采用一",
        status: "accepted",
        violations: [],
      },
    },
    {
      itemKey: "experiences:云图数据",
      sectionKind: "experiences",
      heading: "云图数据",
      slot: 1,
      text: "原始二",
      sourceHash: polishSourceHash("原始二"),
      factIds: [],
      stale: false,
      polish: {
        id: "p2",
        suggestion: "改写二",
        accepted: null,
        status: "pending",
        violations: [],
      },
    },
  ],
};

function client() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(resumeStyleKey, DEFAULT_RESUME_STYLE);
  qc.setQueryData(resumeDesignsKey, { designs: [], currentId: null });
  qc.setQueryData(polishKey, polishState);
  return qc;
}

describe("简历面板的润色预览", () => {
  it("待定从有到 0 时自动关闭，本来就是 0 打开的不关", () => {
    expect(shouldClosePolishPreview(2, 0)).toBe(true);
    expect(shouldClosePolishPreview(0, 0)).toBe(false);
    expect(shouldClosePolishPreview(2, 1)).toBe(false);
  });

  it("显示待定数量和编号标记，可都用上或关闭", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={client()}>
          <ToastProvider>
            <ResumePane
              resume={resume}
              completeness={completeness}
              highlights={new Set()}
              tailorJob={null}
              tailor={null}
              polishOpen
              onPolishClose={() => {}}
              onTailorShow={() => {}}
              onTailorDiscard={() => {}}
              onAskAi={() => {}}
              streaming={false}
            />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(html).toContain("润色预览 · 1 处待定");
    expect(html).toContain("都用上");
    expect(html).toContain("关闭");
    expect(html).toContain("改写二");
    expect(html).toContain("&quot;number&quot;:2");
    expect(html).toContain("&quot;before&quot;:[&quot;原始二&quot;]");
  });
});
