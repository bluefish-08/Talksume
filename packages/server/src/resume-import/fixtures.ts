import { Profile, profileToResume } from "@talksume/core";

// 虚构样例：人名、学校、项目、联系方式均为编造
export const liMingProfile = Profile.parse({
  basics: { name: "李明", phone: "139-0000-1234", email: "liming@example.com", city: "江城" },
  education: [
    {
      id: "e1",
      school: "江城大学",
      degree: "bachelor",
      major: "软件工程",
      gpa: "3.6/4.0",
      start: "2023-09",
      end: "2027-06",
    },
  ],
  projects: [
    {
      id: "p1",
      name: "校园食堂点餐小程序",
      role: "后端开发",
      techStack: ["Spring Boot", "MySQL", "Redis"],
      highlights: [
        { title: "订单模块", detail: "负责订单模块和支付回调接口的开发" },
        { title: "菜单缓存", detail: "使用 Redis 缓存菜单数据，高峰期接口响应从 600ms 降到 150ms" },
      ],
      start: "2024-09",
      end: "2025-01",
    },
  ],
  skills: [{ id: "s1", name: "Java" }],
});

export const liMingResume = profileToResume(liMingProfile);

export const LI_MING_TEXT = `李明
电话：139-0000-1234 | 邮箱：liming@example.com | 江城
教育背景
江城大学 · 软件工程 · 本科 2023.09 – 2027.06
GPA 3.6/4.0
项目经历
校园食堂点餐小程序 · 后端开发 2024.09 – 2025.01
技术栈：Spring Boot、MySQL、Redis
负责订单模块和支付回调接口的开发
使用 Redis 缓存菜单数据，高峰期接口响应从 600ms 降到 150ms
专业技能
熟悉 Java、Spring Boot`;

/** 只有一张位图、没有文字层的 PDF，模拟扫描件。 */
export function imageOnlyPdf(pages = 1): Uint8Array {
  const objects: string[] = [];
  const pageIds = Array.from({ length: pages }, (_, i) => 4 + i * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`);
  objects.push(
    "<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 4 >>\nstream\n\u0000ÿÿ\u0000\nendstream",
  );
  for (const id of pageIds) {
    const draw = "q 595 0 0 842 0 0 cm /Im1 Do Q";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  }
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
