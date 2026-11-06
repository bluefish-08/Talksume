import type { ChatImage } from "@talksume/agent";
import { analyzeImage, describePalette } from "@talksume/resume-render";

/** 给模型的图片附注：量出来的主要色值。失败就不附，不影响对话。 */
export async function imageNotes(images: readonly ChatImage[]): Promise<string[]> {
  const notes = await Promise.all(
    images.map(async (image, i) => {
      try {
        const { colors, facts } = await analyzeImage(Buffer.from(image.data, "base64"), image.mimeType);
        if (colors.length === 0) return "";
        return `第 ${i + 1} 张图量出的事实（比肉眼准，以它为准）：${facts.join("；")}；主要颜色（占比由高到低）：${describePalette(colors)}。复刻时主色、色块、标题色请直接取自这些色值`;
      } catch {
        return "";
      }
    }),
  );
  return notes.filter(Boolean);
}
