import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeContent } from "../../api/types.ts";
import { type ChangeMarks, changeMarkParts, decoratePreview, PREVIEW_CSS } from "./ResumePreview.tsx";

const BULLET = "用 Go 重写订单查询接口，P99 降低 40%";

const resume: ResumeContent = {
  basics: { name: "李明", contacts: [] },
  sections: [
    {
      kind: "projects",
      title: "项目经历",
      items: [{ heading: "订单查询服务", bullets: [{ text: BULLET, factIds: ["f1"] }] }],
    },
  ],
};

class FakeElement {
  className = "";
  textContent = "";
  tabIndex: number | undefined;
  dataset: Record<string, string> = {};
  readonly attrs = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parent: FakeElement | undefined;
  readonly classList = {
    add: (...names: string[]) => {
      const current = this.className.split(/\s+/).filter(Boolean);
      this.className = [...new Set([...current, ...names])].join(" ");
    },
    contains: (name: string) => this.className.split(/\s+/).includes(name),
  };

  readonly tagName: string;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (matches(child, selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
}

function hasAncestorClass(node: FakeElement, name: string): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.classList.contains(name)) return true;
  }
  return false;
}

function matches(node: FakeElement, selector: string): boolean {
  switch (selector) {
    case "*":
      return true;
    case ".resume":
    case ".item-head":
    case ".main":
    case ".frame":
    case ".hl":
    case ".pop":
    case ".change-no":
    case ".changed":
    case ".traceable":
      return node.classList.contains(selector.slice(1));
    case "h2":
      return node.tagName === "h2";
    case "[data-item]":
      return node.dataset.item !== undefined;
    case "[data-bullet]":
      return node.dataset.bullet !== undefined;
    case "section[data-kind]":
      return node.tagName === "section" && node.dataset.kind !== undefined;
    case ".head h1":
      return node.tagName === "h1" && hasAncestorClass(node, "head");
    case ".head .summary":
      return node.classList.contains("summary") && hasAncestorClass(node, "head");
    default:
      throw new Error(`unsupported selector: ${selector}`);
  }
}

function textOf(node: FakeElement): string {
  return node.textContent + node.children.map(textOf).join("");
}

function makeRoot(): FakeElement {
  const root = new FakeElement("body");
  const page = new FakeElement("div");
  page.className = "resume";
  const head = new FakeElement("header");
  head.className = "head";
  const h1 = new FakeElement("h1");
  h1.textContent = resume.basics.name;
  head.append(h1);
  const section = new FakeElement("section");
  section.dataset = { kind: "projects", section: "0" };
  const h2 = new FakeElement("h2");
  h2.textContent = "项目经历";
  const secBody = new FakeElement("div");
  secBody.className = "sec-body";
  const item = new FakeElement("div");
  item.className = "item";
  item.dataset = { item: "0-0" };
  const itemHead = new FakeElement("div");
  itemHead.className = "item-head";
  const ul = new FakeElement("ul");
  const bullet = new FakeElement("li");
  bullet.dataset = { bullet: "0-0-0" };
  bullet.textContent = BULLET;
  ul.append(bullet);
  item.append(itemHead, ul);
  secBody.append(item);
  section.append(h2, secBody);
  page.append(head, section);
  root.append(page);
  return root;
}

beforeEach(() => {
  vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("定制版的纸面标记", () => {
  it("只有编号和左侧竖线，没有黄底和「已定制」角标", () => {
    const parts = changeMarkParts({ label: "要点措辞", number: 2, before: ["旧文案"] });
    expect(parts).toMatchObject({ className: "changed traceable", number: 2 });
    expect(parts.badge).toBeUndefined();
    expect(parts.className).not.toContain("new-tag");
    expect(PREVIEW_CSS).toContain(".resume .changed { border-left: 2px solid #2563eb;");
    expect(PREVIEW_CSS).toContain(".resume .traceable:hover > .pop");
    expect(PREVIEW_CSS).toContain(".resume .changed.traceable:hover");
    expect(PREVIEW_CSS).toContain(".resume .pop-head");
    expect(PREVIEW_CSS).not.toContain(".pop-edit");
    expect(PREVIEW_CSS).not.toContain(".pop-tag");
    expect(PREVIEW_CSS).not.toContain(".hl.traceable");
    expect(PREVIEW_CSS).not.toContain("#fdf6e3");
    expect(PREVIEW_CSS).not.toContain("#ecd28f");
    expect(PREVIEW_CSS).not.toContain("tailor-tag");
    expect(PREVIEW_CSS).not.toContain("已定制");
  });

  it("没有编号的改动不打编号点", () => {
    expect(changeMarkParts({ label: "摘要", before: ["旧摘要"] }).number).toBeUndefined();
  });
});

describe("装饰后的预览", () => {
  it("有 factIds 的条目不再带溯源浮层", () => {
    const root = makeRoot();
    decoratePreview(root as unknown as ParentNode, resume, {
      idPrefix: "test",
      highlightTexts: new Set([BULLET]),
    });

    expect(root.querySelectorAll(".pop")).toHaveLength(0);
    expect(root.querySelectorAll(".traceable")).toHaveLength(0);
    expect(textOf(root)).not.toContain("依据");
    expect(textOf(root)).not.toContain("改这条");
    expect(textOf(root)).not.toContain("待确认");
    expect(
      root
        .querySelectorAll("*")
        .some((node) => node.tabIndex !== undefined || node.attrs.has("aria-describedby")),
    ).toBe(false);
  });

  it("定制改动仍渲染编号和「原文」浮层", () => {
    const root = makeRoot();
    const marks: ChangeMarks = {
      bullets: new Map([[BULLET, { label: "要点措辞", number: 2, before: ["旧文案"] }]]),
      items: new Map(),
      sections: new Map(),
    };
    decoratePreview(root as unknown as ParentNode, resume, { idPrefix: "test", changeMarks: marks });

    const changed = root.querySelectorAll(".changed");
    expect(changed).toHaveLength(1);
    const bullet = changed[0];
    expect(bullet?.classList.contains("traceable")).toBe(true);
    expect(bullet?.querySelector(".change-no")?.textContent).toBe("2");

    const pop = bullet?.querySelector(".pop");
    if (!pop) throw new Error("改动要点应带「原文」浮层");
    expect(pop.attrs.get("role")).toBe("tooltip");
    expect(textOf(pop)).toContain("要点措辞 · 原文");
    expect(textOf(pop)).toContain("旧文案");
  });
});
