import { polishSourceHash, type ResumeContent } from "@talksume/core";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { qk } from "../../api/queries.ts";
import type { PolishCard } from "../chat/types.ts";
import {
  applyPolishUpdate,
  buildPolishPreview,
  type PolishEntry,
  type PolishState,
  polishKey,
} from "./polishQueries.ts";

const resume: ResumeContent = {
  basics: { name: "李明", contacts: [] },
  sections: [
    {
      kind: "experiences",
      title: "实习经历",
      items: [
        {
          heading: "云图数据",
          bullets: [
            { text: "原始一", factIds: [] },
            { text: "原始二", factIds: [] },
          ],
        },
      ],
    },
  ],
};

const entries: PolishEntry[] = [
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
];

const state: PolishState = { available: true, entries };

describe("润色预览", () => {
  it("把待定建议叠到简历上，编号和卡片一致", () => {
    const preview = buildPolishPreview(resume, entries);
    expect(preview.pending).toBe(1);
    expect(preview.ids).toEqual(["p2"]);
    expect(preview.resume.sections[0]?.items[0]?.bullets.map((b) => b.text)).toEqual(["原始一", "改写二"]);
    expect(preview.marks.bullets.get("改写二")).toEqual({
      label: "润色",
      number: 2,
      before: ["原始二"],
    });
  });

  it("流式 update 先补缓存，再让简历和润色状态失效重拉", () => {
    const client = new QueryClient();
    client.setQueryData(polishKey, state);
    client.setQueryData(qk.resume, { resume: null });
    const card: PolishCard = {
      kind: "update",
      status: "partial",
      items: [
        {
          id: "p1",
          number: 1,
          heading: "云图数据",
          before: "原始一",
          after: "采用一",
          state: "accepted",
          blocked: false,
        },
        {
          id: "p2",
          number: 2,
          heading: "云图数据",
          before: "原始二",
          after: "新建议",
          state: "dismissed",
          blocked: false,
        },
      ],
    };
    applyPolishUpdate(client, card);
    const patched = client.getQueryData<PolishState>(polishKey);
    expect(patched?.entries[1]?.polish).toMatchObject({
      suggestion: "新建议",
      status: "dismissed",
      accepted: null,
    });
    expect(client.getQueryState(polishKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(qk.resume)?.isInvalidated).toBe(true);
  });
});
