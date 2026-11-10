import { describe, expect, it } from "vitest";
import { SAMPLE_PALETTE, brandCodeWarning, parseHex, validatePaletteDraft } from "./palette.ts";

describe("色板", () => {
  it("示例色板使用自编代号，并能解析 HEX", () => {
    expect(SAMPLE_PALETTE.kind).toBe("sample");
    expect(SAMPLE_PALETTE.notice).toContain("不对应");
    expect(SAMPLE_PALETTE.notice).toContain("Perler");
    expect(SAMPLE_PALETTE.colors.length).toBeGreaterThan(16);
    expect(new Set(SAMPLE_PALETTE.colors.map((color) => color.code)).size).toBe(SAMPLE_PALETTE.colors.length);
    expect(SAMPLE_PALETTE.colors.every((color) => /^#[0-9A-F]{6}$/.test(color.hex))).toBe(true);
    expect(parseHex("#c4342a")).toEqual({ r: 196, g: 52, b: 42, hex: "#C4342A" });
    expect(parseHex("#abc")).toBeNull();
    expect(parseHex("red")).toBeNull();
  });

  it("校验自编色板，并提醒看起来像品牌色号的代号", () => {
    const ok = validatePaletteDraft([
      { code: "A1", name: "赤", hex: "#aa1122" },
      { code: "b_2", name: "青", hex: "334455" },
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.colors[1]?.hex).toBe("#334455");

    expect(validatePaletteDraft([]).ok).toBe(false);
    expect(validatePaletteDraft([{ code: "A1", name: "赤", hex: "#aa1122" }, { code: "A1", name: "重复", hex: "#000000" }]).ok).toBe(
      false,
    );
    expect(validatePaletteDraft([{ code: "=A1", name: "赤", hex: "#aa1122" }]).ok).toBe(false);
    expect(brandCodeWarning("K1")).toBeNull();
    expect(brandCodeWarning("Perler-01")).toContain("官方色库");
    expect(brandCodeWarning("mard12")).toContain("官方色库");
  });
});
