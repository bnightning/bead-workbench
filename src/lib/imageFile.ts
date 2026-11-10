export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type ImageKind = "png" | "jpeg" | "webp";

export type InspectResult = { ok: true; kind: ImageKind } | { ok: false; message: string };

export function inspectImageFile(byteLength: number, header: Uint8Array): InspectResult {
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    return { ok: false, message: "文件是空的。" };
  }
  if (byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, message: "文件超过 8MB，请先压缩或缩小后再上传。" };
  }
  const kind = detectImageKind(header);
  if (!kind) {
    return { ok: false, message: "只支持 PNG、JPEG 和 WebP。请换一张这三种格式的图片。" };
  }
  return { ok: true, kind };
}

export function detectImageKind(header: Uint8Array): ImageKind | null {
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return "png";
  }
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "jpeg";
  }
  if (
    header.length >= 12 &&
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export const DECODE_ERROR = "这张图片无法解码，可能已损坏。请换一张 PNG、JPEG 或 WebP。";
