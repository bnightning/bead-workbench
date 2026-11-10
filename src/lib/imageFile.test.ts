import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, inspectImageFile } from "./imageFile.ts";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

describe("图片格式和大小", () => {
  it("识别 PNG、JPEG 和 WebP", () => {
    expect(inspectImageFile(32, png)).toEqual({ ok: true, kind: "png" });
    expect(inspectImageFile(32, jpeg)).toEqual({ ok: true, kind: "jpeg" });
    expect(inspectImageFile(32, webp)).toEqual({ ok: true, kind: "webp" });
  });

  it("拒绝空文件、超限和其他格式", () => {
    expect(inspectImageFile(0, png).ok).toBe(false);
    expect(inspectImageFile(-1, png).ok).toBe(false);
    const tooBig = inspectImageFile(MAX_IMAGE_BYTES + 1, png);
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.message).toContain("8MB");
    const other = inspectImageFile(20, gif);
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.message).toContain("PNG");
    expect(inspectImageFile(12, Uint8Array.from([0x89, 0x50, 0x4e, 0x47])).ok).toBe(false);
  });
});
