// 上传图片：类型只看文件内容，元数据（EXIF、XMP、文字块）无损剥离，不重编码也不解码像素

export const IMAGE_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxSide: 8000,
  maxPixels: 40_000_000,
  /** 每个用户最多保留几张，超过时删最旧的。 */
  perUser: 30,
} as const;

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export type ImageErrorCode = "unsupported_type" | "too_large" | "corrupt" | "bad_dimensions";

export class ImageError extends Error {
  readonly code: ImageErrorCode;
  readonly status: number;
  constructor(code: ImageErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface CleanImage {
  mimeType: ImageMime;
  data: Buffer;
  width: number;
  height: number;
}

const corrupt = () => new ImageError("corrupt", "图片文件已损坏或不完整，请换一张");

function checkDims(width: number, height: number): void {
  if (
    width < 1 ||
    height < 1 ||
    width > IMAGE_LIMITS.maxSide ||
    height > IMAGE_LIMITS.maxSide ||
    width * height > IMAGE_LIMITS.maxPixels
  ) {
    throw new ImageError("bad_dimensions", `图片尺寸不合适（单边不超过 ${IMAGE_LIMITS.maxSide} 像素）`);
  }
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD"]);

function cleanPng(buf: Buffer): CleanImage {
  const out: Buffer[] = [PNG_SIG];
  let pos = PNG_SIG.length;
  let width = 0;
  let height = 0;
  let idat = 0;
  let ended = false;
  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const end = pos + 12 + length;
    if (end > buf.length) throw corrupt();
    if (pos === PNG_SIG.length) {
      if (type !== "IHDR" || length !== 13) throw corrupt();
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
      checkDims(width, height);
    }
    if (PNG_KEEP.has(type)) {
      out.push(buf.subarray(pos, end));
      if (type === "IDAT") idat++;
    }
    pos = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || idat === 0 || width === 0) throw corrupt();
  return { mimeType: "image/png", data: Buffer.concat(out), width, height };
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function cleanJpeg(buf: Buffer): CleanImage {
  const out: Buffer[] = [buf.subarray(0, 2)];
  let pos = 2;
  let width = 0;
  let height = 0;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) throw corrupt();
    const marker = buf[pos + 1] as number;
    if (marker === 0xff) {
      pos++;
      continue;
    }
    const length = buf.readUInt16BE(pos + 2);
    const end = pos + 2 + length;
    if (length < 2 || end > buf.length) throw corrupt();
    if (marker === 0xda) {
      if (width === 0) throw corrupt();
      const tail = buf.subarray(pos);
      if (tail.length < 2 || tail[tail.length - 2] !== 0xff || tail[tail.length - 1] !== 0xd9)
        throw corrupt();
      out.push(tail);
      return { mimeType: "image/jpeg", data: Buffer.concat(out), width, height };
    }
    if (JPEG_SOF.has(marker)) {
      if (length < 8) throw corrupt();
      height = buf.readUInt16BE(pos + 5);
      width = buf.readUInt16BE(pos + 7);
      checkDims(width, height);
    }
    // APPn（EXIF、XMP、缩略图）和注释一律丢弃，APP14 是 Adobe 色彩变换，解码需要
    const metadata = (marker >= 0xe0 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    if (!metadata) out.push(buf.subarray(pos, end));
    pos = end;
  }
  throw corrupt();
}

function webpDims(type: string, data: Buffer): [number, number] | undefined {
  if (type === "VP8 " && data.length >= 10 && data[3] === 0x9d && data[4] === 0x01 && data[5] === 0x2a) {
    return [data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff];
  }
  if (type === "VP8L" && data.length >= 5 && data[0] === 0x2f) {
    const bits = data.readUInt32LE(1);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  if (type === "VP8X" && data.length >= 10) {
    return [data.readUIntLE(4, 3) + 1, data.readUIntLE(7, 3) + 1];
  }
  return undefined;
}

function cleanWebp(buf: Buffer): CleanImage {
  const riffSize = buf.readUInt32LE(4);
  if (riffSize + 8 > buf.length) throw corrupt();
  const chunks: { type: string; raw: Buffer; data: Buffer }[] = [];
  let pos = 12;
  while (pos + 8 <= riffSize + 8) {
    const type = buf.toString("latin1", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const end = pos + 8 + size + (size % 2);
    if (end > riffSize + 8 || pos + 8 + size > buf.length) throw corrupt();
    chunks.push({ type, raw: buf.subarray(pos, end), data: buf.subarray(pos + 8, pos + 8 + size) });
    pos = end;
  }
  if (chunks.some((c) => c.type === "ANIM" || c.type === "ANMF")) {
    throw new ImageError("unsupported_type", "暂不支持动图，请换成静态图片");
  }
  let dims: [number, number] | undefined;
  for (const c of chunks) dims ??= webpDims(c.type, c.data);
  if (!dims || !chunks.some((c) => c.type === "VP8 " || c.type === "VP8L")) throw corrupt();
  checkDims(dims[0], dims[1]);
  const kept = chunks
    .filter((c) => c.type !== "EXIF" && c.type !== "XMP " && c.type !== "ICCP")
    .map((c) => {
      if (c.type !== "VP8X") return c.raw;
      const fixed = Buffer.from(c.raw);
      fixed[8] = (fixed[8] as number) & ~(0x08 | 0x04 | 0x20);
      return fixed;
    });
  const body = Buffer.concat(kept);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length + 4, 4);
  head.write("WEBP", 8, "latin1");
  return { mimeType: "image/webp", data: Buffer.concat([head, body]), width: dims[0], height: dims[1] };
}

export function sniffImage(buf: Buffer): ImageMime | undefined {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP")
    return "image/webp";
  return undefined;
}

/** 校验并清洗：不认的类型、过大、损坏、尺寸离谱都抛 ImageError。 */
export function cleanImage(buf: Buffer): CleanImage {
  if (buf.length > IMAGE_LIMITS.maxBytes) {
    throw new ImageError("too_large", `图片不能超过 ${IMAGE_LIMITS.maxBytes / 1024 / 1024} MB`, 413);
  }
  const kind = sniffImage(buf);
  if (!kind) throw new ImageError("unsupported_type", "只支持 PNG、JPEG、WebP 图片", 415);
  try {
    return kind === "image/png" ? cleanPng(buf) : kind === "image/jpeg" ? cleanJpeg(buf) : cleanWebp(buf);
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw corrupt();
  }
}
