import { describe, expect, it } from "vitest";
import { buildGrid } from "./grid.ts";
import { SAMPLE_PALETTE } from "./palette.ts";
import { SAMPLES, countSampleColors, paintToRaster } from "./samples.ts";

describe("原创示例", () => {
  it("山月铺满格子，茶杯留有透明空位，颗数和图例一致", () => {
    expect(SAMPLES.map((sample) => sample.id)).toEqual(["shan-yue", "tea", "boat", "flower"]);
    for (const sample of SAMPLES) {
      const raster = paintToRaster(sample);
      const grid = buildGrid(raster, SAMPLE_PALETTE.colors, {
        longestSide: Math.max(sample.width, sample.height),
        minSide: 8,
        maxSide: 120,
        maxColors: Math.max(countSampleColors(sample), 2),
        alphaThreshold: 128,
        minOpaqueRatio: 0.5,
      });
      expect(grid.width).toBe(sample.width);
      expect(grid.height).toBe(sample.height);
      expect(grid.totalBeads).toBeGreaterThan(0);
      expect(grid.counts.reduce((sum, item) => sum + item.count, 0)).toBe(grid.totalBeads);
      expect(grid.counts.length).toBeLessThanOrEqual(countSampleColors(sample));
    }
    const mountain = SAMPLES[0];
    const tea = SAMPLES[1];
    if (!mountain || !tea) throw new Error("缺少示例");
    const mountainGrid = buildGrid(paintToRaster(mountain), SAMPLE_PALETTE.colors, {
      longestSide: 48,
      minSide: 8,
      maxSide: 120,
      maxColors: 32,
      alphaThreshold: 128,
      minOpaqueRatio: 0.5,
    });
    expect(mountainGrid.totalBeads).toBe(mountain.width * mountain.height);
    const teaGrid = buildGrid(paintToRaster(tea), SAMPLE_PALETTE.colors, {
      longestSide: 32,
      minSide: 8,
      maxSide: 120,
      maxColors: 32,
      alphaThreshold: 128,
      minOpaqueRatio: 0.5,
    });
    expect(teaGrid.totalBeads).toBeLessThan(tea.width * tea.height);
  });
});
