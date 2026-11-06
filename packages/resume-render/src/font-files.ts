// 仅 Node 端使用（读 @fontsource 的字体文件）；浏览器端只拿到字体名列表，字体由服务端提供
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { ResumeFontName } from "@talksume/core";

const require = createRequire(import.meta.url);

const SOURCES: Record<ResumeFontName, { pkg: string; family: string; weights: number[] }> = {
  song: { pkg: "noto-serif-sc", family: "Talksume Song", weights: [400, 700] },
  hei: { pkg: "noto-sans-sc", family: "Talksume Hei", weights: [400, 700] },
  brush: { pkg: "ma-shan-zheng", family: "Talksume Brush", weights: [400] },
};

/** PDF 和截图用的虚拟地址：请求会被拦截并从本地文件应答，不会真的联网。 */
export const FONT_ORIGIN = "https://fonts.talksume.invalid/";

interface Face {
  file: string;
  weight: number;
  range: string;
  dir: string;
}

const cache = new Map<ResumeFontName, Face[]>();

function facesOf(name: ResumeFontName): Face[] {
  const hit = cache.get(name);
  if (hit) return hit;
  const src = SOURCES[name];
  const dir = dirname(require.resolve(`@fontsource/${src.pkg}/package.json`));
  const faces: Face[] = [];
  for (const weight of src.weights) {
    const css = readFileSync(join(dir, `${weight}.css`), "utf8");
    for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
      const file = block.match(/url\(\.\/files\/([a-z0-9-]+\.woff2)\)/)?.[1];
      const range = block.match(/unicode-range:\s*([^;]+);/)?.[1];
      if (file && range) faces.push({ file, weight, range, dir: join(dir, "files") });
    }
  }
  cache.set(name, faces);
  return faces;
}

/** 用到的字体的 @font-face，字体文件地址用 base 做前缀。 */
export function fontFaceCss(names: readonly ResumeFontName[], base: string): string {
  return names
    .flatMap((name) =>
      facesOf(name).map(
        (f) =>
          `@font-face{font-family:"${SOURCES[name].family}";font-style:normal;font-weight:${f.weight};font-display:block;src:url(${base}${f.file}) format("woff2");unicode-range:${f.range}}`,
      ),
    )
    .join("\n");
}

const SAFE_FILE = /^[a-z0-9-]+\.woff2$/;

/** 按文件名取字体文件；只认 fontsource 里解析出来的那几个，路径穿越之类一律返回 undefined。 */
export function fontFile(file: string): Buffer | undefined {
  if (!SAFE_FILE.test(file)) return undefined;
  for (const name of Object.keys(SOURCES) as ResumeFontName[]) {
    const face = facesOf(name).find((f) => f.file === file);
    if (face) return readFileSync(join(face.dir, file));
  }
  return undefined;
}

export function isFontName(value: string): value is ResumeFontName {
  return Object.hasOwn(SOURCES, value);
}
