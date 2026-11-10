import { axisGutter } from "./boardLayout.ts";
import type { ColorCount, GridResult } from "./grid.ts";
import { parseHex } from "./palette.ts";
import { basisLabel, formatBp, formatCents, type QuoteResult } from "./pricing.ts";

export interface BoardStyle {
  cellSize: number;
  roundBeads: boolean;
  showCodes: boolean;
}

export interface ExportMeta {
  title: string;
  paletteNotice: string;
  quote: QuoteResult | null;
  quoteMessage: string | null;
  laborLine?: string | null;
}

const INK = "#241C16";
const PAPER = "#FBF7F0";
const MUTED = "#6D6256";

export function readableInk(r: number, g: number, b: number): string {
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance > 150 ? INK : "#F7F3EA";
}

function boardPixelSize(grid: GridResult, cellSize: number): { width: number; height: number; gutter: number } {
  const gutter = axisGutter(cellSize);
  return {
    gutter,
    width: gutter + grid.width * cellSize + 8,
    height: gutter + grid.height * cellSize + 8,
  };
}

function colorMap(grid: GridResult): Map<number, ColorCount> {
  return new Map(grid.counts.map((count) => [count.index, count]));
}

export function paintBoard(
  context: CanvasRenderingContext2D,
  grid: GridResult,
  style: BoardStyle,
  originX = 0,
  originY = 0,
): { width: number; height: number } {
  const { width, height, gutter } = boardPixelSize(grid, style.cellSize);
  const colors = colorMap(grid);
  context.fillStyle = "#E7E0D4";
  context.fillRect(originX, originY, width, height);

  const axisFont = Math.max(8, Math.min(12, Math.round(style.cellSize * 0.42)));
  context.font = `${axisFont}px "PingFang SC", "Noto Sans CJK SC", "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif`;
  context.fillStyle = MUTED;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const labelEvery = style.cellSize >= 14 ? 1 : 5;
  for (let x = 0; x < grid.width; x += 1) {
    if (labelEvery !== 1 && (x + 1) % labelEvery !== 0 && x !== 0) continue;
    context.fillText(
      String(x + 1),
      originX + gutter + x * style.cellSize + style.cellSize / 2,
      originY + gutter / 2,
    );
  }
  for (let y = 0; y < grid.height; y += 1) {
    if (labelEvery !== 1 && (y + 1) % labelEvery !== 0 && y !== 0) continue;
    context.fillText(
      String(y + 1),
      originX + gutter / 2,
      originY + gutter + y * style.cellSize + style.cellSize / 2,
    );
  }

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const index = grid.indices[y * grid.width + x] ?? -1;
      const left = originX + gutter + x * style.cellSize;
      const top = originY + gutter + y * style.cellSize;
      const color = index >= 0 ? colors.get(index) : undefined;
      if (!color) {
        context.fillStyle = (x + y) % 2 === 0 ? "#F6F1E6" : "#E7DCCB";
        context.fillRect(left, top, style.cellSize, style.cellSize);
        continue;
      }
      if (style.roundBeads) {
        context.fillStyle = (x + y) % 2 === 0 ? "#F3EBDD" : "#E9DFD0";
        context.fillRect(left, top, style.cellSize, style.cellSize);
        const radius = style.cellSize * 0.4;
        const cx = left + style.cellSize / 2;
        const cy = top + style.cellSize / 2;
        context.beginPath();
        context.arc(cx, cy, radius, 0, Math.PI * 2);
        context.fillStyle = color.hex;
        context.fill();
        context.beginPath();
        context.arc(cx - radius * 0.32, cy - radius * 0.32, radius * 0.24, 0, Math.PI * 2);
        context.fillStyle = "rgba(255,255,255,0.38)";
        context.fill();
      } else {
        context.fillStyle = color.hex;
        context.fillRect(left + 0.5, top + 0.5, style.cellSize - 1, style.cellSize - 1);
      }
      if (style.showCodes && style.cellSize >= 16) {
        const rgb = parseHex(color.hex);
        context.fillStyle = rgb ? readableInk(rgb.r, rgb.g, rgb.b) : INK;
        context.font = `600 ${Math.max(8, Math.round(style.cellSize * 0.32))}px "PingFang SC", "Noto Sans CJK SC", "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(color.code, left + style.cellSize / 2, top + style.cellSize / 2 + 0.5);
      }
    }
  }
  return { width, height };
}

export function drawPreview(canvas: HTMLCanvasElement, grid: GridResult, style: BoardStyle): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = boardPixelSize(grid, style.cellSize);
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  canvas.width = Math.round(size.width * dpr);
  canvas.height = Math.round(size.height * dpr);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, size.width, size.height);
  paintBoard(context, grid, style, 0, 0);
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const char of text) {
    const next = line + char;
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function renderPatternCanvas(grid: GridResult, meta: ExportMeta): HTMLCanvasElement {
  let cellSize = 18;
  const legendWidth = 340;
  const margin = 36;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const board = boardPixelSize(grid, cellSize);
    const width = margin * 2 + board.width + legendWidth + 24;
    const height = margin * 2 + 120 + board.height + 220;
    if (width <= 7600 && height <= 7600) break;
    cellSize -= 2;
  }
  const board = boardPixelSize(grid, cellSize);
  const legendRows = Math.max(grid.counts.length, 1);
  const legendHeight = 48 + legendRows * 28;
  const width = margin * 2 + board.width + legendWidth + 28;
  const height = margin * 2 + 96 + Math.max(board.height, legendHeight) + 250;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  context.fillStyle = PAPER;
  context.fillRect(0, 0, width, height);
  context.fillStyle = INK;
  context.font = `600 32px "Songti SC", "Noto Serif CJK SC", "WenQuanYi Micro Hei", "Droid Sans Fallback", serif`;
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText(meta.title || "未命名方案", margin, margin);
  context.font = `14px "PingFang SC", "Noto Sans CJK SC", "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif`;
  context.fillStyle = MUTED;
  const subtitle = `${grid.width} × ${grid.height} 格 · 用豆 ${grid.totalBeads} 颗 · 列号从左到右，行号从上到下`;
  context.fillText(subtitle, margin, margin + 42);

  paintBoard(context, grid, { cellSize, roundBeads: true, showCodes: cellSize >= 16 }, margin, margin + 84);

  const legendX = margin + board.width + 28;
  let legendY = margin + 84;
  context.fillStyle = INK;
  context.font = `600 18px "Songti SC", "Noto Serif CJK SC", "WenQuanYi Micro Hei", serif`;
  context.fillText("用豆清单", legendX, legendY);
  legendY += 32;
  context.font = `13px "PingFang SC", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif`;
  if (grid.counts.length === 0) {
    context.fillStyle = MUTED;
    context.fillText("没有可拼的豆子", legendX, legendY);
  }
  for (const count of grid.counts) {
    context.fillStyle = count.hex;
    context.beginPath();
    context.arc(legendX + 10, legendY + 8, 8, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = INK;
    context.fillText(`${count.code} ${count.name}  ${count.count} 颗`, legendX + 26, legendY);
    legendY += 28;
  }

  let textY = margin + 84 + board.height + 28;
  context.fillStyle = INK;
  context.font = `600 18px "Songti SC", "Noto Serif CJK SC", "WenQuanYi Micro Hei", serif`;
  context.fillText("试算", margin, textY);
  textY += 30;
  context.font = `14px "PingFang SC", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif`;
  const lines: string[] = [];
  if (meta.quote) {
    const quote = meta.quote;
    lines.push(
      `豆材（含损耗）${formatCents(quote.beadCostCents)} 元 · 人工 ${formatCents(quote.laborCostCents)} 元 · 包装 ${formatCents(quote.packagingCents)} 元 · 其他 ${formatCents(quote.otherCents)} 元`,
    );
    lines.push(`成本合计 ${formatCents(quote.totalCostCents)} 元`);
    lines.push(`建议售价 ${formatCents(quote.suggestedPriceCents)} 元（${basisLabel(quote.basis)}），仅供店主参考`);
    lines.push(`最终报价 ${formatCents(quote.finalPriceCents)} 元 · 利润 ${formatCents(quote.profitCents)} 元`);
    lines.push(
      quote.grossMarginBp === null
        ? "毛利率无法计算（售价为 0）"
        : `毛利率 ${formatBp(quote.grossMarginBp)} = (售价 − 成本) / 售价`,
    );
    lines.push(
      quote.markupBp === null
        ? "加价率无法计算（成本为 0）"
        : `加价率 ${formatBp(quote.markupBp)} = (售价 − 成本) / 成本，与毛利率不是同一个数`,
    );
  } else {
    lines.push(meta.quoteMessage ?? "成本还没算清，图纸上未写金额。");
  }
  if (meta.laborLine) lines.push(meta.laborLine);
  lines.push("默认单价、速度和毛利率若未改过，只是示例假设，不是市场报价，也不承诺制作耗时。");
  for (const line of lines) {
    context.fillStyle = INK;
    context.fillText(line, margin, textY);
    textY += 22;
  }

  context.fillStyle = MUTED;
  context.font = `12px "PingFang SC", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif`;
  const footer = `${meta.paletteNotice} 本图在浏览器本地生成，不是客户订单或付款凭证。`;
  for (const line of wrapText(context, footer, width - margin * 2)) {
    context.fillText(line, margin, textY);
    textY += 18;
  }
  return canvas;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("导出 PNG 失败"));
      else resolve(blob);
    }, "image/png");
  });
}
