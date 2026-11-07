import { DEFAULT_RESUME_STYLE } from "@talksume/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Completeness, ResumeContent } from "../../api/types.ts";
import { ToastProvider } from "../../components/Toast.tsx";
import { polishKey } from "../resume/polishQueries.ts";
import { resumeDesignsKey, resumeStyleKey } from "../resume/queries.ts";
import { applyTailorUpdate, type TailoringView, tailoringKey, tailoringsKey } from "../tailor/queries.ts";
import { ResumePane, ResumePaneHeader, type TailorJob } from "./ResumePane.tsx";
import { TailorCardView } from "./TailorCard.tsx";
import { cardStatus } from "./tailorCards.ts";
import type { TailorCard } from "./types.ts";

vi.mock("../resume/ResumePreview.tsx", () => ({ ResumePreview: () => null }));

const resume: ResumeContent = {
  basics: { name: "李明", contacts: [] },
  sections: [
    {
      kind: "skills",
      title: "专业技能",
      items: [{ heading: "熟练", bullets: [{ text: "Java", factIds: [] }] }],
    },
  ],
};

const completeness: Completeness = {
  score: 0.79,
  sections: [],
  missing: [],
};

const job: TailorJob = { jobId: "demo:mt1", company: "美团", title: "后端开发工程师（实习）" };

const generationCard: TailorCard = {
  ...job,
  changes: 1,
  rejected: 0,
  kind: "generation",
  status: "draft",
  items: [
    {
      id: "summary",
      number: 1,
      title: "摘要",
      summary: "补一段和岗位相关的摘要",
      selected: true,
      blocked: false,
    },
  ],
};

function clientFor(revoked = false): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(resumeStyleKey, DEFAULT_RESUME_STYLE);
  client.setQueryData(resumeDesignsKey, { designs: [], currentId: null });
  client.setQueryData([...tailoringsKey, "adopted"], []);
  client.setQueryData(polishKey, { available: true, entries: [] });
  client.setQueryData(tailoringKey(job.jobId), {
    available: true,
    job: { id: job.jobId, company: job.company, title: job.title },
    tailoring: {
      base: resume,
      changes: [{ id: "summary", kind: "summary", after: "摘要", violations: [], before: undefined }],
      selected: [],
      revoked,
      adopted: null,
      conversationId: "c1",
      stale: false,
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  });
  return client;
}

function renderHeader(
  tailorJob: TailorJob | null,
  options: { status?: "draft" | "adopted" | "revoked"; showing?: boolean } = {},
): string {
  const status = options.status ?? "draft";
  return renderToStaticMarkup(
    <MemoryRouter>
      <QueryClientProvider client={clientFor(status === "revoked")}>
        <ToastProvider>
          <ResumePaneHeader
            resume={resume}
            pct={Math.round(completeness.score * 100)}
            tailorJob={tailorJob}
            status={status}
            changes={tailorJob ? 1 : 0}
            showing={options.showing ?? false}
            busy={false}
            canAdopt={Boolean(tailorJob)}
            adopting={false}
            onShow={() => {}}
            onDiscard={() => {}}
            onAdopt={() => {}}
            onRevoke={() => {}}
            onAskAi={() => {}}
            askAiDisabled={false}
          />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function renderPane(options: { layout: "narrow" | "wide"; showing: boolean; revoked?: boolean }): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <QueryClientProvider client={clientFor(options.revoked)}>
        <ToastProvider>
          <div data-layout={options.layout}>
            <ResumePane
              resume={resume}
              completeness={completeness}
              highlights={new Set()}
              quotes={{}}
              tailorJob={job}
              tailor={{ ...job, showing: options.showing, at: 1 }}
              onTailorShow={() => {}}
              onTailorDiscard={() => {}}
              onAskAi={() => {}}
              onEditQuote={() => {}}
              streaming={false}
            />
          </div>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("简历面板头部", () => {
  it("没有定制版时只有「简历」标题和样式/润色/导出三个图标，没有原话记录页签", () => {
    const html = renderHeader(null);
    expect(html).toContain("简历 <span");
    expect(html).toContain("79%");
    expect(html).not.toContain("原话记录");
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
    expect(html).toContain('aria-label="简历样式：');
    expect(html).toContain('aria-label="润色"');
    expect(html).toContain('aria-label="导出"');
    expect(html).not.toContain("定制版 ·");
    expect(html).not.toContain("用这版");
  });

  it("润色图标在样式和导出之间，主简历时可见、定制版显示时隐藏", () => {
    const main = renderHeader(job, { showing: false });
    const styleAt = main.indexOf('aria-label="简历样式：');
    const polishAt = main.indexOf('aria-label="润色"');
    const exportAt = main.indexOf('aria-label="导出"');
    expect(styleAt).toBeGreaterThanOrEqual(0);
    expect(polishAt).toBeGreaterThan(styleAt);
    expect(exportAt).toBeGreaterThan(polishAt);

    const tailored = renderHeader(job, { showing: true });
    expect(tailored).not.toContain('aria-label="润色"');
    expect(tailored).toContain('aria-label="简历样式：');
    expect(tailored).toContain('aria-label="导出"');
  });

  it("有草稿时同一行加版本按钮和用这版", () => {
    const html = renderHeader(job);
    expect(html).toContain("美团定制版 · 草稿");
    expect(html).toContain("用这版");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-label="导出"');
  });

  it("撤销后版本按钮改为中性的「主简历 · 已改回」，没有警告圆点", () => {
    const html = renderHeader(job, { status: "revoked" });
    expect(html).toContain("主简历 · 已改回");
    expect(html).toContain('data-dot="none"');
    expect(html).toContain('data-status="revoked"');
    expect(html).not.toContain("美团定制版 · 草稿");
    expect(html).not.toContain("用这版");
  });
});

describe("聊天简历面板的版本入口", () => {
  for (const layout of ["narrow", "wide"] as const) {
    it(`${layout === "narrow" ? "窄屏全屏" : "宽屏"}布局查看主简历时只有单行头部，没有旧切换器`, () => {
      const html = renderPane({ layout, showing: false });
      expect((html.match(/<header/g) ?? []).length).toBe(1);
      expect(html).toContain("美团定制版 · 草稿");
      expect(html).toContain('aria-label="润色"');
      expect(html).not.toContain('aria-label="简历版本"');
      expect(html).not.toContain("aria-pressed");
    });
  }

  it("显示定制版时同样没有旧切换器，且润色隐藏", () => {
    const html = renderPane({ layout: "wide", showing: true });
    expect(html).toContain("美团定制版 · 草稿");
    expect(html).not.toContain('aria-label="简历版本"');
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain('aria-label="润色"');
  });

  it("撤销后仍由头部版本按钮承接，不出现旧切换器", () => {
    const html = renderPane({ layout: "narrow", showing: false, revoked: true });
    expect(html).toContain("主简历 · 已改回");
    expect(html).not.toContain('aria-label="简历版本"');
    expect(html).not.toContain("aria-pressed");
  });
});

describe("流式定制更新", () => {
  it("adopt 更新事件立即把卡片和版本按钮刷成已采用，不需要重新拉取", () => {
    const client = clientFor(false);
    applyTailorUpdate(client, {
      ...generationCard,
      kind: "update",
      status: "adopted",
      changes: 1,
    });
    const patched = client.getQueryData<TailoringView>(tailoringKey(job.jobId));
    expect(patched?.tailoring?.adopted).not.toBeNull();
    expect(patched?.tailoring?.selected).toEqual(["summary"]);

    const cardHtml = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <TailorCardView card={generationCard} superseded={false} onOpen={() => {}} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(cardHtml).toContain("已采用");
    expect(cardHtml).not.toContain("草稿");
    expect(cardHtml).not.toContain("用这版");
    expect(cardHtml).not.toContain("在右边看");

    const headerHtml = renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ToastProvider>
            <ResumePaneHeader
              resume={resume}
              pct={79}
              tailorJob={job}
              status={cardStatus(patched?.tailoring)}
              changes={1}
              showing={false}
              busy={false}
              canAdopt
              adopting={false}
              onShow={() => {}}
              onDiscard={() => {}}
              onAdopt={() => {}}
              onRevoke={() => {}}
              onAskAi={() => {}}
              askAiDisabled={false}
            />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(headerHtml).toContain("美团定制版 · 已采用");
  });

  it("revoke 更新事件立即改回主简历状态", () => {
    const client = clientFor(false);
    applyTailorUpdate(client, {
      ...generationCard,
      kind: "update",
      status: "revoked",
      items: [],
    });
    const patched = client.getQueryData<TailoringView>(tailoringKey(job.jobId));
    expect(patched?.tailoring?.revoked).toBe(true);
    expect(patched?.tailoring?.adopted).toBeNull();
    expect(patched?.tailoring?.selected).toEqual([]);

    const headerHtml = renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ToastProvider>
            <ResumePaneHeader
              resume={resume}
              pct={79}
              tailorJob={job}
              status={cardStatus(patched?.tailoring)}
              changes={0}
              showing={false}
              busy={false}
              canAdopt={false}
              adopting={false}
              onShow={() => {}}
              onDiscard={() => {}}
              onAdopt={() => {}}
              onRevoke={() => {}}
              onAskAi={() => {}}
              askAiDisabled={false}
            />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(headerHtml).toContain("主简历 · 已改回");
  });
});
