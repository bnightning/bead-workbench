import type { PaletteColor } from "./grid.ts";

export interface Palette {
  id: string;
  name: string;
  kind: "sample" | "custom";
  notice: string;
  colors: PaletteColor[];
}

export const SAMPLE_PALETTE_NOTICE =
  "「纸间」是本工具自编的示例色板。K1、R2 这类代号只为方便对照格子，不对应 MARD、Perler、Hama、Artkal 或任何品牌的官方色号，也不能保证和实物豆子颜色一致。";

export const CUSTOM_PALETTE_NOTICE =
  "这是保存在此浏览器里的自编色板。代号由你决定，本工具没有品牌官方色库，不会把这些代号标成真实色号。";

const RAW_COLORS: Array<[string, string, string]> = [
  ["K1", "松烟", "#221C18"],
  ["K2", "灰褐", "#5C534C"],
  ["K3", "暖灰", "#9A9186"],
  ["W1", "宣纸", "#F6F1E6"],
  ["W2", "米汤", "#E4D5BB"],
  ["R1", "朱砂", "#C4342A"],
  ["R2", "胭脂", "#8E2A3A"],
  ["R3", "粉桃", "#E7A0A4"],
  ["O1", "柿色", "#E06A2C"],
  ["O2", "杏黄", "#F0B15A"],
  ["Y1", "藤黄", "#F2D15A"],
  ["Y2", "淡黄", "#F7E7A1"],
  ["G1", "松绿", "#2F6B45"],
  ["G2", "草绿", "#6EA84A"],
  ["G3", "薄荷", "#B7D7A8"],
  ["T1", "青绿", "#1F7A72"],
  ["T2", "湖色", "#7EC8C3"],
  ["B1", "靛蓝", "#243E78"],
  ["B2", "琉璃", "#3D6FBF"],
  ["B3", "晴空", "#9EC3EA"],
  ["B4", "夜蓝", "#15233F"],
  ["P1", "紫藤", "#6A4C93"],
  ["P2", "丁香", "#C3AAD4"],
  ["N1", "栗壳", "#6B3E2A"],
  ["N2", "枯木", "#A56B45"],
  ["N3", "沙色", "#D9C2A0"],
  ["E1", "浅肤", "#F0C9A0"],
  ["E2", "深肤", "#C48A62"],
  ["M1", "洋红", "#D23C78"],
  ["C1", "墨青", "#1E3A40"],
  ["C2", "青瓷", "#D5EBE3"],
  ["S1", "石青", "#6E8CA0"],
];

export function parseHex(input: string): { r: number; g: number; b: number; hex: string } | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(input.trim());
  if (!match?.[1]) return null;
  const n = Number.parseInt(match[1], 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
    hex: `#${match[1].toUpperCase()}`,
  };
}

function colorFromRaw(code: string, name: string, hex: string): PaletteColor {
  const parsed = parseHex(hex);
  if (!parsed) throw new Error(`示例色板颜色无效：${code}`);
  return { code, name, hex: parsed.hex, r: parsed.r, g: parsed.g, b: parsed.b };
}

export const SAMPLE_PALETTE: Palette = {
  id: "paper-sample-v1",
  name: "纸间示例色板",
  kind: "sample",
  notice: SAMPLE_PALETTE_NOTICE,
  colors: RAW_COLORS.map(([code, name, hex]) => colorFromRaw(code, name, hex)),
};

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,7}$/;

export function validatePaletteDraft(
  rows: Array<{ code: string; name: string; hex: string }>,
): { ok: true; colors: PaletteColor[] } | { ok: false; message: string } {
  if (rows.length < 1) return { ok: false, message: "色板至少要有 1 个颜色。" };
  if (rows.length > 96) return { ok: false, message: "色板最多 96 个颜色。" };
  const seen = new Set<string>();
  const colors: PaletteColor[] = [];
  for (const row of rows) {
    const code = row.code.trim();
    const name = row.name.trim();
    const shown = code.slice(0, 20) || "空";
    if (!CODE_RE.test(code)) {
      return {
        ok: false,
        message: `代号「${shown}」需以字母或数字开头，最长 8 位，只能含字母、数字、下划线或短横线。`,
      };
    }
    if (seen.has(code)) return { ok: false, message: `代号 ${code} 重复了。` };
    seen.add(code);
    if (!name || name.length > 16 || /[\r\n,]/.test(name)) {
      return { ok: false, message: `颜色 ${code} 的名称需要 1 到 16 个字，且不要包含逗号或换行。` };
    }
    const parsed = parseHex(row.hex);
    if (!parsed) return { ok: false, message: `颜色 ${code} 的 HEX 无效，请使用 #RRGGBB。` };
    colors.push({ code, name, hex: parsed.hex, r: parsed.r, g: parsed.g, b: parsed.b });
  }
  return { ok: true, colors };
}

export function brandCodeWarning(code: string): string | null {
  if (/mard|perler|hama|artkal|nabbi/i.test(code)) {
    return "这个代号像在引用品牌色号。本工具没有这些品牌的官方色库，不能把它当成真实色号。";
  }
  return null;
}

export function paletteFromColors(colors: PaletteColor[], kind: "sample" | "custom"): Palette {
  if (kind === "sample") return SAMPLE_PALETTE;
  return {
    id: "custom",
    name: "自编色板",
    kind: "custom",
    notice: CUSTOM_PALETTE_NOTICE,
    colors,
  };
}
