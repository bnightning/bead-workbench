import type { PaletteColor, RgbaRaster } from "./grid.ts";
import { SAMPLE_PALETTE } from "./palette.ts";

export interface PaintedSample {
  id: string;
  name: string;
  caption: string;
  width: number;
  height: number;
  pixels: Uint8Array;
}

const TRANSPARENT = 255;

interface Painter {
  width: number;
  height: number;
  pixels: Uint8Array;
  set: (x: number, y: number, code: string) => void;
  ellipse: (cx: number, cy: number, rx: number, ry: number, code: string | null) => void;
  fill: (code: string) => void;
}

function createPainter(width: number, height: number): Painter {
  const pixels = new Uint8Array(width * height);
  pixels.fill(TRANSPARENT);
  const indexOf = new Map(SAMPLE_PALETTE.colors.map((color, index) => [color.code, index]));
  const resolve = (code: string) => {
    const index = indexOf.get(code);
    if (index === undefined) throw new Error(`未知示例色号 ${code}`);
    return index;
  };
  const set = (x: number, y: number, code: string) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= width || yi >= height) return;
    pixels[yi * width + xi] = resolve(code);
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, code: string | null) => {
    if (rx <= 0 || ry <= 0) return;
    const value = code === null ? TRANSPARENT : resolve(code);
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y += 1) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) pixels[y * width + x] = value;
      }
    }
  };
  const fill = (code: string) => {
    pixels.fill(resolve(code));
  };
  return { width, height, pixels, set, ellipse, fill };
}

function paintMountain(): PaintedSample {
  const painter = createPainter(48, 32);
  painter.fill("B4");
  painter.ellipse(37, 8, 4.2, 4.2, "W1");
  painter.ellipse(38.2, 7.2, 1.1, 1.1, "Y2");
  for (const [x, y] of [
    [4, 3],
    [8, 6],
    [13, 2],
    [18, 5],
    [22, 3],
    [27, 7],
    [6, 11],
    [16, 9],
    [30, 4],
  ] as const) {
    painter.set(x, y, "Y2");
  }
  for (let x = 0; x < 48; x += 1) {
    const ridge = 15 + Math.round(Math.sin(x * 0.45) * 2.2 + Math.sin(x * 0.13) * 2.4);
    for (let y = ridge; y < 32; y += 1) painter.set(x, y, "B1");
  }
  for (let x = 0; x < 48; x += 1) {
    const ridge = 22 + Math.round(Math.sin(x * 0.28 + 0.8) * 3.1);
    for (let y = ridge; y < 32; y += 1) painter.set(x, y, "K1");
    if (x % 3 !== 0) painter.set(x, ridge, "W2");
  }
  for (let y = 18; y <= 23; y += 1) painter.set(8, y, "G1");
  painter.set(7, 19, "G1");
  painter.set(9, 19, "G1");
  painter.set(7, 20, "G2");
  painter.set(9, 20, "G2");
  return {
    id: "shan-yue",
    name: "山月",
    caption: "夜空、月亮和两层山。整张铺满，用来看坐标和色号。",
    width: 48,
    height: 32,
    pixels: painter.pixels,
  };
}

function paintTea(): PaintedSample {
  const painter = createPainter(32, 32);
  painter.ellipse(15, 26, 10, 2.5, "N3");
  painter.ellipse(15, 25.2, 7.5, 1.2, "E1");
  for (let y = 11; y <= 23; y += 1) {
    const half = 6.2 + ((y - 11) / 12) * 1.5;
    for (let x = Math.round(14 - half); x <= Math.round(14 + half); x += 1) painter.set(x, y, "W2");
  }
  for (let y = 13; y <= 17; y += 1) {
    for (let x = 10; x <= 18; x += 1) painter.set(x, y, "T1");
  }
  for (let x = 9; x <= 19; x += 1) painter.set(x, 11, "W1");
  painter.ellipse(23.5, 17, 3.3, 4.2, "N2");
  painter.ellipse(23.5, 17, 1.5, 2.2, null);
  painter.set(13, 7, "K3");
  painter.set(14, 5, "K3");
  painter.set(12, 4, "W1");
  painter.set(16, 6, "K3");
  return {
    id: "tea",
    name: "一盏茶",
    caption: "透明背景上的杯子。空白处不应被算成豆子。",
    width: 32,
    height: 32,
    pixels: painter.pixels,
  };
}

function paintBoat(): PaintedSample {
  const painter = createPainter(46, 28);
  painter.fill("B3");
  for (let y = 18; y < 28; y += 1) {
    for (let x = 0; x < 46; x += 1) {
      painter.set(x, y, (x + y) % 6 === 0 ? "B2" : "B1");
    }
  }
  for (let y = 14; y <= 19; y += 1) {
    const inset = (y - 14) * 0.55;
    for (let x = Math.round(12 + inset); x <= Math.round(34 - inset); x += 1) painter.set(x, y, "W1");
  }
  for (let x = 14; x <= 32; x += 1) painter.set(x, 14, "K2");
  for (let x = 20; x <= 28; x += 1) {
    for (let y = 10; y <= 14; y += 1) painter.set(x, y, "O2");
  }
  for (let y = 4; y <= 14; y += 1) painter.set(24, y, "N1");
  for (let y = 5; y <= 12; y += 1) {
    const reach = Math.round((12 - y) * 0.8);
    for (let x = 25; x <= 25 + reach; x += 1) painter.set(x, y, "W2");
  }
  return {
    id: "boat",
    name: "水面船",
    caption: "整幅水面和一艘小船，适合看连续色块。",
    width: 46,
    height: 28,
    pixels: painter.pixels,
  };
}

function paintFlower(): PaintedSample {
  const painter = createPainter(32, 32);
  painter.ellipse(11, 24, 6, 2.6, "G1");
  painter.ellipse(21, 25, 6, 2.6, "G2");
  for (let y = 16; y <= 27; y += 1) painter.set(16, y, "G1");
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    const cx = 16 + Math.cos(angle) * 6.5;
    const cy = 14 + Math.sin(angle) * 6.5;
    painter.ellipse(cx, cy, 3.2, 2.3, index % 2 === 0 ? "R1" : "R3");
  }
  painter.ellipse(16, 14, 3.1, 3.1, "Y1");
  painter.ellipse(16, 14, 1.3, 1.3, "O1");
  return {
    id: "flower",
    name: "小菊",
    caption: "花瓣和叶子留在透明底上，用来看少量颜色。",
    width: 32,
    height: 32,
    pixels: painter.pixels,
  };
}

export const SAMPLES: PaintedSample[] = [paintMountain(), paintTea(), paintBoat(), paintFlower()];

export function getSample(id: string): PaintedSample | undefined {
  return SAMPLES.find((sample) => sample.id === id);
}

export function countSampleColors(sample: PaintedSample): number {
  const used = new Set<number>();
  for (const pixel of sample.pixels) {
    if (pixel !== TRANSPARENT) used.add(pixel);
  }
  return used.size;
}

export function paintToRaster(sample: PaintedSample, palette: PaletteColor[] = SAMPLE_PALETTE.colors): RgbaRaster {
  const data = new Uint8ClampedArray(sample.width * sample.height * 4);
  for (let index = 0; index < sample.pixels.length; index += 1) {
    const colorIndex = sample.pixels[index] ?? TRANSPARENT;
    const offset = index * 4;
    if (colorIndex === TRANSPARENT) {
      data[offset + 3] = 0;
      continue;
    }
    const color = palette[colorIndex];
    if (!color) continue;
    data[offset] = color.r;
    data[offset + 1] = color.g;
    data[offset + 2] = color.b;
    data[offset + 3] = 255;
  }
  return { width: sample.width, height: sample.height, data };
}
