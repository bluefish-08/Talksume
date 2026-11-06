import type { ResumeContent } from "@talksume/core";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const PHONE = /(?<![\d\w])(?:\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}(?!\d)/g;

const maskEmail = (value: string) => `${"x".repeat(Math.max(3, value.indexOf("@")))}@example.com`;
const maskPhone = (value: string) => value.replace(/\d/g, (d, i) => (i < 3 ? d : "*"));

/** 发给模型看的预览图不带真实手机号、邮箱和链接，版面宽度基本不变。 */
export function maskContacts(content: ResumeContent): ResumeContent {
  const text = (s: string) => s.replace(EMAIL, maskEmail).replace(PHONE, maskPhone);
  return {
    ...content,
    basics: {
      ...content.basics,
      contacts: content.basics.contacts.map(text),
      ...(content.basics.links && {
        links: content.basics.links.map((l) => ({
          ...l,
          url: `https://example.com/${"x".repeat(Math.max(3, l.url.replace(/^https?:\/\/[^/]+\/?/, "").length))}`,
        })),
      }),
    },
  };
}
