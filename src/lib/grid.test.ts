import { describe, expect, it } from "vitest";
import {
  GridError,
  assembleGrid,
  buildGrid,
  fitGridSize,
  limitColorCount,
  nearestIndex,
  type PaletteColor,
  type RgbaRaster,
} from "./grid.ts";

const red: PaletteColor = { code: "R", name: "红", hex: "#FF0000", r: 255, g: 0, b: 0 };
const green: PaletteColor = { code: "G", name: "绿", hex: "#00FF00", r: 0, g: 255, b: 0 };
const blue: PaletteColor = { code: "B", name: "蓝", hex: "#0000FF", r: 0, g: 0, b: 255 };
const black: PaletteColor = { code: "K", name: "黑", hex: "#000000", r: 0, g: 0, b: 0 };
const nearBlack: PaletteColor = { code: "A", name: "近黑甲", hex: "#00000A", r: 0, g: 0, b: 10 };
const nearWhite: PaletteColor = { code: "C", name: "近黑乙", hex: "#0000F6", r: 0, g: 0, b: 246 };

function raster(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): RgbaRaster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = fill(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }
  return { width, height, data };
}

const baseOptions = {
  minSide: 1,
  maxSide: 160,
  maxColors: 8,
  alphaThreshold: 128,
  minOpaqueRatio: 0.5,
};

describe("网格尺寸", () => {
  it("按最长边缩放并保持比例", () => {
    expect(fitGridSize({ srcWidth: 100, srcHeight: 50, longestSide: 40, minSide: 8, maxSide: 160 })).toEqual({
      width: 40,
      height: 20,
    });
    expect(fitGridSize({ srcWidth: 50, srcHeight: 100, longestSide: 40, minSide: 8, maxSide: 160 })).toEqual({
      width: 20,
      height: 40,
    });
    expect(fitGridSize({ srcWidth: 100, srcHeight: 100, longestSide: 40, minSide: 8, maxSide: 160 })).toEqual({
      width: 40,
      height: 40,
    });
  });

  it("过小或过大的最长边会被夹到边界内", () => {
    expect(fitGridSize({ srcWidth: 100, srcHeight: 50, longestSide: 4, minSide: 8, maxSide: 160 })).toEqual({
      width: 8,
      height: 4,
    });
    expect(fitGridSize({ srcWidth: 100, srcHeight: 100, longestSide: 500, minSide: 8, maxSide: 160 })).toEqual({
      width: 160,
      height: 160,
    });
    expect(fitGridSize({ srcWidth: 300, srcHeight: 10, longestSide: 90, minSide: 8, maxSide: 160 })).toEqual({
      width: 90,
      height: 3,
    });
  });

  it("拒绝无效的原图和格数", () => {
    expect(() => fitGridSize({ srcWidth: 0, srcHeight: 10, longestSide: 40, minSide: 8, maxSide: 160 })).toThrow(GridError);
    expect(() => fitGridSize({ srcWidth: 10, srcHeight: 10, longestSide: 0, minSide: 8, maxSide: 160 })).toThrow(GridError);
    expect(() => fitGridSize({ srcWidth: 10, srcHeight: 10, longestSide: 1.5, minSide: 8, maxSide: 160 })).toThrow(
      GridError,
    );
    expect(() => fitGridSize({ srcWidth: 10, srcHeight: 10, longestSide: 40, minSide: 0, maxSide: 160 })).toThrow(
      GridError,
    );
    expect(() => fitGridSize({ srcWidth: 10, srcHeight: 10, longestSide: 40, minSide: 20, maxSide: 10 })).toThrow(
      GridError,
    );
  });
});

describe("透明像素不计豆", () => {
  it("全透明和低于阈值的像素都是空位", () => {
    const image = raster(2, 2, (x, y) => {
      if (x === 0 && y === 0) return [255, 0, 0, 255];
      if (x === 1 && y === 0) return [255, 0, 0, 128];
      if (x === 0 && y === 1) return [255, 0, 0, 10];
      return [255, 0, 0, 0];
    });
    const grid = buildGrid(image, [red, blue], { ...baseOptions, longestSide: 2 });
    expect(grid.width).toBe(2);
    expect(grid.height).toBe(2);
    expect(grid.totalBeads).toBe(1);
    expect(grid.counts).toEqual([{ index: 0, code: "R", name: "红", hex: "#FF0000", count: 1 }]);
    expect([...grid.indices]).toEqual([0, -1, -1, -1]);
  });

  it("alpha 刚好高于阈值时计豆", () => {
    const image = raster(1, 1, () => [0, 0, 255, 129]);
    const grid = buildGrid(image, [red, blue], { ...baseOptions, longestSide: 1, alphaThreshold: 128 });
    expect(grid.totalBeads).toBe(1);
    expect(grid.counts[0]?.code).toBe("B");
  });

  it("格子里不透明像素不够一半时不计豆，刚好一半时计豆", () => {
    const sparse = raster(2, 2, (x, y) => (x === 0 && y === 0 ? [255, 0, 0, 255] : [255, 0, 0, 0]));
    const sparseGrid = buildGrid(sparse, [red], {
      ...baseOptions,
      longestSide: 1,
      minOpaqueRatio: 0.5,
    });
    expect(sparseGrid.width).toBe(1);
    expect(sparseGrid.totalBeads).toBe(0);

    const half = raster(2, 2, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    const halfGrid = buildGrid(half, [red], { ...baseOptions, longestSide: 1, minOpaqueRatio: 0.5 });
    expect(halfGrid.totalBeads).toBe(1);
    expect(halfGrid.counts[0]?.count).toBe(1);
  });

  it("整张透明图的总豆数为 0", () => {
    const image = raster(3, 2, () => [1, 2, 3, 0]);
    const grid = buildGrid(image, [red, blue], { ...baseOptions, longestSide: 3 });
    expect(grid.totalBeads).toBe(0);
    expect(grid.counts).toEqual([]);
  });
});

describe("近似色和颜色数上限", () => {
  it("把像素配到距离最近的色板颜色，距离相同时用更靠前的颜色", () => {
    expect(nearestIndex(250, 10, 10, [red, green, blue])).toBe(0);
    expect(nearestIndex(10, 10, 240, [red, green, blue])).toBe(2);
    expect(nearestIndex(0, 0, 128, [nearBlack, nearWhite])).toBe(0);
  });

  it("每个颜色的颗数相加等于总豆数", () => {
    const image = raster(4, 3, (x) => {
      if (x === 0) return [255, 0, 0, 255];
      if (x === 1) return [0, 255, 0, 255];
      if (x === 2) return [0, 0, 255, 255];
      return [0, 0, 0, 0];
    });
    const grid = buildGrid(image, [red, green, blue, black], { ...baseOptions, longestSide: 4, maxColors: 8 });
    expect(grid.totalBeads).toBe(9);
    expect(grid.counts.reduce((sum, item) => sum + item.count, 0)).toBe(grid.totalBeads);
    expect(grid.counts.map((item) => item.count).sort((a, b) => a - b)).toEqual([3, 3, 3]);
  });

  it("超过最大颜色数时，把用量最少的颜色并入最近的保留色", () => {
    const cells = [
      ...Array.from({ length: 5 }, () => ({ empty: false, r: 255, g: 0, b: 0 })),
      ...Array.from({ length: 3 }, () => ({ empty: false, r: 0, g: 0, b: 255 })),
      { empty: false, r: 0, g: 255, b: 0 },
    ];
    const grid = assembleGrid(3, 3, cells, [red, blue, green], 2);
    expect(grid.counts).toHaveLength(2);
    expect(grid.totalBeads).toBe(9);
    expect(grid.counts.reduce((sum, item) => sum + item.count, 0)).toBe(9);
    const redCount = grid.counts.find((item) => item.code === "R")?.count;
    const blueCount = grid.counts.find((item) => item.code === "B")?.count;
    expect(redCount).toBe(6);
    expect(blueCount).toBe(3);
    expect(grid.counts.some((item) => item.code === "G")).toBe(false);
  });

  it("最大颜色数为 1 时所有豆子合成一个颜色", () => {
    const image = raster(2, 2, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    const grid = buildGrid(image, [red, blue, green], { ...baseOptions, longestSide: 2, maxColors: 1 });
    expect(grid.counts).toHaveLength(1);
    expect(grid.counts[0]?.count).toBe(4);
    expect(grid.totalBeads).toBe(4);
  });

  it("色板比最大颜色数更少时，结果不会超出色板", () => {
    const image = raster(2, 2, (x, y) => {
      if (x === 0 && y === 0) return [255, 0, 0, 255];
      if (x === 1 && y === 0) return [0, 255, 0, 255];
      return [0, 0, 255, 255];
    });
    const grid = buildGrid(image, [red, blue], { ...baseOptions, longestSide: 2, maxColors: 10 });
    expect(grid.counts.length).toBeLessThanOrEqual(2);
    expect(grid.counts.every((item) => item.code === "R" || item.code === "B")).toBe(true);
    expect(grid.totalBeads).toBe(4);
  });

  it("拒绝 0、小数和过大的最大颜色数", () => {
    const image = raster(1, 1, () => [255, 0, 0, 255]);
    expect(() => buildGrid(image, [red], { ...baseOptions, longestSide: 1, maxColors: 0 })).toThrow(GridError);
    expect(() => buildGrid(image, [red], { ...baseOptions, longestSide: 1, maxColors: 1.5 })).toThrow(GridError);
    expect(() => buildGrid(image, [red], { ...baseOptions, longestSide: 1, maxColors: 257 })).toThrow(GridError);
  });

  it("已经在上限内时不改索引", () => {
    const indices = Int16Array.from([0, 1, 0, -1]);
    expect([...limitColorCount(indices, [red, blue], 2)]).toEqual([0, 1, 0, -1]);
  });
});

describe("比例放大后的透明底", () => {
  it("16×16 中间 8×8 红块放大到 40 格时只数到红块覆盖的格子", () => {
    const image = raster(16, 16, (x, y) => (x >= 4 && x <= 11 && y >= 4 && y <= 11 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    const native = buildGrid(image, [red, blue], { ...baseOptions, longestSide: 16, minSide: 8, maxSide: 120 });
    expect(native.totalBeads).toBe(64);

    const scaled = buildGrid(image, [red, blue], { ...baseOptions, longestSide: 40, minSide: 8, maxSide: 120 });
    expect(scaled.width).toBe(40);
    expect(scaled.height).toBe(40);
    expect(scaled.totalBeads).toBe(400);
    expect(scaled.counts).toEqual([{ index: 0, code: "R", name: "红", hex: "#FF0000", count: 400 }]);
  });
});
