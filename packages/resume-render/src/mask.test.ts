import { describe, expect, it } from "vitest";
import { maskContacts, sampleResume } from "./index.ts";

describe("maskContacts", () => {
  it("手机号、邮箱、链接不带真实内容，其余内容不动", () => {
    const content = {
      ...sampleResume,
      basics: {
        ...sampleResume.basics,
        contacts: ["13812345678", "liming@example.com", "江城"],
        links: [{ label: "GitHub", url: "https://github.com/real-person-name" }],
      },
    };
    const out = maskContacts(content);
    const json = JSON.stringify(out.basics);
    expect(json).not.toContain("13812345678");
    expect(json).not.toContain("liming@");
    expect(json).not.toContain("real-person-name");
    expect(out.basics.contacts[0]).toBe("138********");
    expect(out.basics.contacts[1]).toMatch(/^x{6}@example\.com$/);
    expect(out.basics.contacts[2]).toBe("江城");
    expect(out.basics.name).toBe(content.basics.name);
    expect(out.sections).toEqual(content.sections);
  });
});
