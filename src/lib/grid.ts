export class GridError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GridError";
    this.code = code;
  }
}

export interface RgbaRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface PaletteColor {
  code: string;
  name: string;
  hex: string;
  r: number;
  g: number;
  b: number;
}

export interface FitGridInput {
  srcWidth: number;
  srcHeight: number;
  longestSide: number;
  minSide: number;
  maxSide: number;
}

export function fitGridSize(input: FitGridInput): { width: number; height: number } {
  const { srcWidth, srcHeight, longestSide, minSide, maxSide } = input;
  if (!Number.isInteger(srcWidth) || !Number.isInteger(srcHeight) || srcWidth < 1 || srcHeight < 1) {
    throw new GridError("BAD_SOURCE", "原图像素尺寸无效");
  }
  if (!Number.isInteger(minSide) || !Number.isInteger(maxSide) || minSide < 1 || maxSide < minSide) {
    throw new GridError("BAD_BOUNDS", "网格尺寸范围无效");
  }
  if (!Number.isInteger(longestSide) || longestSide < 1) {
    throw new GridError("BAD_SIDE", "最长边格数必须是正整数");
  }
  const target = Math.min(maxSide, Math.max(minSide, longestSide));
  const srcLong = Math.max(srcWidth, srcHeight);
  let width = Math.max(1, Math.round((srcWidth * target) / srcLong));
  let height = Math.max(1, Math.round((srcHeight * target) / srcLong));
  const peak = Math.max(width, height);
  if (peak > maxSide) {
    const scale = maxSide / peak;
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }
  return { width, height };
}

export interface SampledCell {
  empty: boolean;
  r: number;
  g: number;
  b: number;
}

export interface SampleOptions {
  gridWidth: number;
  gridHeight: number;
  /** alpha 小于或等于该值的像素视为透明 */
  alphaThreshold: number;
  /** 不透明像素占比低于该值的格子不计豆。等于该值时计豆 */
  minOpaqueRatio: number;
}

function assertSampleOptions(raster: RgbaRaster, options: SampleOptions): void {
  if (!Number.isInteger(raster.width) || !Number.isInteger(raster.height) || raster.width < 1 || raster.height < 1) {
    throw new GridError("BAD_SOURCE", "原图像素尺寸无效");
  }
  if (raster.data.length !== raster.width * raster.height * 4) {
    throw new GridError("BAD_SOURCE", "像素数据和尺寸对不上");
  }
  if (raster.width * raster.height > 8_000_000) {
    throw new GridError("BAD_SOURCE", "原图太大，请先缩小再试");
  }
  if (
    !Number.isInteger(options.gridWidth) ||
    !Number.isInteger(options.gridHeight) ||
    options.gridWidth < 1 ||
    options.gridHeight < 1 ||
    options.gridWidth * options.gridHeight > 512 * 512
  ) {
    throw new GridError("BAD_GRID", "网格尺寸超出可计算范围");
  }
  if (!Number.isInteger(options.alphaThreshold) || options.alphaThreshold < 0 || options.alphaThreshold > 255) {
    throw new GridError("BAD_ALPHA", "透明阈值必须是 0 到 255 的整数");
  }
  if (!Number.isFinite(options.minOpaqueRatio) || options.minOpaqueRatio < 0 || options.minOpaqueRatio > 1) {
    throw new GridError("BAD_RATIO", "不透明占比必须在 0 到 1 之间");
  }
}

function sampleCell(raster: RgbaRaster, options: SampleOptions, x: number, y: number): SampledCell {
  let x0 = Math.floor((x * raster.width) / options.gridWidth);
  let x1 = Math.floor(((x + 1) * raster.width) / options.gridWidth);
  let y0 = Math.floor((y * raster.height) / options.gridHeight);
  let y1 = Math.floor(((y + 1) * raster.height) / options.gridHeight);
  if (x1 <= x0) x1 = x0 + 1;
  if (y1 <= y0) y1 = y0 + 1;
  if (x1 > raster.width) x1 = raster.width;
  if (y1 > raster.height) y1 = raster.height;

  let total = 0;
  let opaque = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const offset = (py * raster.width + px) * 4;
      const alpha = raster.data[offset + 3] ?? 0;
      total += 1;
      if (alpha > options.alphaThreshold) {
        opaque += 1;
        sr += raster.data[offset] ?? 0;
        sg += raster.data[offset + 1] ?? 0;
        sb += raster.data[offset + 2] ?? 0;
      }
    }
  }
  if (total === 0 || opaque === 0 || opaque / total < options.minOpaqueRatio) {
    return { empty: true, r: 0, g: 0, b: 0 };
  }
  return {
    empty: false,
    r: Math.round(sr / opaque),
    g: Math.round(sg / opaque),
    b: Math.round(sb / opaque),
  };
}

export function sampleRaster(raster: RgbaRaster, options: SampleOptions, rowStart = 0, rowEnd = options.gridHeight): SampledCell[] {
  assertSampleOptions(raster, options);
  if (!Number.isInteger(rowStart) || !Number.isInteger(rowEnd) || rowStart < 0 || rowEnd > options.gridHeight || rowEnd < rowStart) {
    throw new GridError("BAD_GRID", "采样行范围无效");
  }
  const cells: SampledCell[] = [];
  for (let y = rowStart; y < rowEnd; y += 1) {
    for (let x = 0; x < options.gridWidth; x += 1) {
      cells.push(sampleCell(raster, options, x, y));
    }
  }
  return cells;
}

export function colorDistance(r: number, g: number, b: number, color: PaletteColor): number {
  const dr = r - color.r;
  const dg = g - color.g;
  const db = b - color.b;
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

export function nearestIndex(r: number, g: number, b: number, palette: PaletteColor[]): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index += 1) {
    const color = palette[index];
    if (!color) continue;
    const distance = colorDistance(r, g, b, color);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

export function limitColorCount(indices: Int16Array, palette: PaletteColor[], maxColors: number): Int16Array {
  const result = new Int16Array(indices);
  const counts = new Int32Array(palette.length);
  let used = 0;
  for (const index of result) {
    if (index < 0) continue;
    if (counts[index] === 0) used += 1;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  const cap = Math.min(maxColors, palette.length);
  while (used > cap) {
    let victim = -1;
    let victimCount = Number.POSITIVE_INFINITY;
    for (let index = 0; index < counts.length; index += 1) {
      const count = counts[index] ?? 0;
      if (count > 0 && (count < victimCount || (count === victimCount && index < victim))) {
        victim = index;
        victimCount = count;
      }
    }
    if (victim < 0) break;
    const victimColor = palette[victim];
    if (!victimColor) break;
    let host = -1;
    let hostDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < counts.length; index += 1) {
      if (index === victim || (counts[index] ?? 0) === 0) continue;
      const color = palette[index];
      if (!color) continue;
      const distance = colorDistance(victimColor.r, victimColor.g, victimColor.b, color);
      if (distance < hostDistance || (distance === hostDistance && (host < 0 || index < host))) {
        hostDistance = distance;
        host = index;
      }
    }
    if (host < 0) break;
    for (let cursor = 0; cursor < result.length; cursor += 1) {
      if (result[cursor] === victim) result[cursor] = host;
    }
    counts[host] = (counts[host] ?? 0) + (counts[victim] ?? 0);
    counts[victim] = 0;
    used -= 1;
  }
  return result;
}

export interface ColorCount {
  index: number;
  code: string;
  name: string;
  hex: string;
  count: number;
}

export interface GridResult {
  width: number;
  height: number;
  indices: Int16Array;
  counts: ColorCount[];
  totalBeads: number;
}

export interface BuildGridOptions {
  longestSide: number;
  minSide: number;
  maxSide: number;
  maxColors: number;
  alphaThreshold: number;
  minOpaqueRatio: number;
}

function assertPaletteAndColors(palette: PaletteColor[], maxColors: number): void {
  if (!Number.isInteger(maxColors) || maxColors < 1 || maxColors > 256) {
    throw new GridError("BAD_MAX_COLORS", "最大颜色数必须是 1 到 256 的整数");
  }
  if (palette.length < 1 || palette.length > 256) {
    throw new GridError("BAD_PALETTE", "色板需要 1 到 256 个颜色");
  }
}

export function assembleGrid(
  width: number,
  height: number,
  cells: SampledCell[],
  palette: PaletteColor[],
  maxColors: number,
): GridResult {
  assertPaletteAndColors(palette, maxColors);
  if (cells.length !== width * height) {
    throw new GridError("BAD_GRID", "采样结果和网格尺寸不一致");
  }
  const mapped = new Int16Array(cells.length);
  mapped.fill(-1);
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (!cell || cell.empty) continue;
    mapped[index] = nearestIndex(cell.r, cell.g, cell.b, palette);
  }
  const indices = limitColorCount(mapped, palette, maxColors);
  const tally = new Map<number, number>();
  let totalBeads = 0;
  for (const index of indices) {
    if (index < 0) continue;
    totalBeads += 1;
    tally.set(index, (tally.get(index) ?? 0) + 1);
  }
  const counts: ColorCount[] = [];
  for (const [index, count] of tally) {
    const color = palette[index];
    if (!color || count <= 0) continue;
    counts.push({ index, code: color.code, name: color.name, hex: color.hex, count });
  }
  counts.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code, "en"));
  const summed = counts.reduce((sum, item) => sum + item.count, 0);
  if (summed !== totalBeads) {
    throw new GridError("BAD_COUNT", "颜色颗数和总豆数不一致");
  }
  return { width, height, indices, counts, totalBeads };
}

export function buildGrid(raster: RgbaRaster, palette: PaletteColor[], options: BuildGridOptions): GridResult {
  assertPaletteAndColors(palette, options.maxColors);
  const size = fitGridSize({
    srcWidth: raster.width,
    srcHeight: raster.height,
    longestSide: options.longestSide,
    minSide: options.minSide,
    maxSide: options.maxSide,
  });
  const cells = sampleRaster(raster, {
    gridWidth: size.width,
    gridHeight: size.height,
    alphaThreshold: options.alphaThreshold,
    minOpaqueRatio: options.minOpaqueRatio,
  });
  return assembleGrid(size.width, size.height, cells, palette, options.maxColors);
}

export async function buildGridAsync(
  raster: RgbaRaster,
  palette: PaletteColor[],
  options: BuildGridOptions,
): Promise<GridResult> {
  assertPaletteAndColors(palette, options.maxColors);
  const size = fitGridSize({
    srcWidth: raster.width,
    srcHeight: raster.height,
    longestSide: options.longestSide,
    minSide: options.minSide,
    maxSide: options.maxSide,
  });
  const sampleOptions: SampleOptions = {
    gridWidth: size.width,
    gridHeight: size.height,
    alphaThreshold: options.alphaThreshold,
    minOpaqueRatio: options.minOpaqueRatio,
  };
  if (size.height <= 48 && raster.width * raster.height <= 400_000) {
    return assembleGrid(size.width, size.height, sampleRaster(raster, sampleOptions), palette, options.maxColors);
  }
  const cells: SampledCell[] = [];
  const rowsPerChunk = 4;
  for (let row = 0; row < size.height; row += rowsPerChunk) {
    const end = Math.min(size.height, row + rowsPerChunk);
    cells.push(...sampleRaster(raster, sampleOptions, row, end));
    if (end < size.height) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return assembleGrid(size.width, size.height, cells, palette, options.maxColors);
}
