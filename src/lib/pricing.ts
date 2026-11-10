/**
 * 金额用整数「分」，损耗和毛利率用「百分数的百分位」（4000 = 40.00%）。
 *
 * 建议售价 = max(成本 / (1 - 毛利率), 成本 + 最低利润, 最低人工保底)
 * 毛利率 = (售价 - 成本) / 售价
 * 加价率 = (售价 - 成本) / 成本
 * 最低利润、最低人工保底为 0 时不参与比较。
 * 损耗按每个颜色的采购颗数向上取整，不在颜色之间挪用零头。
 */

export class QuoteError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "QuoteError";
    this.code = code;
  }
}

export interface QuoteLineInput {
  code: string;
  name: string;
  usedBeads: number;
  unitPriceCents: number;
}

export interface QuoteInput {
  lines: QuoteLineInput[];
  /** 0–10000，800 表示 8.00% */
  wasteHundredths: number;
  /** 150 表示 1.50 小时，上限 1000 小时 */
  laborHourHundredths: number;
  hourlyRateCents: number;
  packagingCents: number;
  otherCents: number;
  /** 0–9999，4000 表示 40.00%。10000（100%）无效 */
  marginHundredths: number;
  /** 0 表示不启用 */
  minProfitCents: number;
  /** 0 表示不启用。这是售价下限，不是在成本之外再加一遍人工 */
  minLaborFloorCents: number;
  /** null 表示最终报价跟随建议售价 */
  finalPriceCents: number | null;
}

export type QuoteBasis = "margin" | "minProfit" | "minLabor";

export interface QuoteLine {
  code: string;
  name: string;
  usedBeads: number;
  purchaseBeads: number;
  unitPriceCents: number;
  amountCents: number;
}

export interface QuoteResult {
  lines: QuoteLine[];
  usedBeads: number;
  purchaseBeads: number;
  beadCostCents: number;
  laborCostCents: number;
  packagingCents: number;
  otherCents: number;
  totalCostCents: number;
  marginPriceCents: number;
  minProfitPriceCents: number | null;
  minLaborPriceCents: number | null;
  suggestedPriceCents: number;
  basis: QuoteBasis;
  finalPriceCents: number;
  profitCents: number;
  /** 售价为 0 时无法计算 */
  grossMarginBp: number | null;
  /** 成本为 0 时无法计算 */
  markupBp: number | null;
}

const MAX_CENTS = 100_000_000_000;
const MAX_BEADS = 10_000_000;

function assertInt(value: number, code: string, message: string, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new QuoteError(code, message);
  }
}

export function purchaseCount(usedBeads: number, wasteHundredths: number): number {
  assertInt(usedBeads, "BAD_COUNT", "用量必须是非负整数", 0, MAX_BEADS);
  assertInt(wasteHundredths, "BAD_WASTE", "损耗必须是 0% 到 100% 之间的数", 0, 10000);
  if (usedBeads === 0) return 0;
  const numerator = usedBeads * (10000 + wasteHundredths);
  return Math.floor((numerator + 9999) / 10000);
}

/** 正数四舍五入（.5 向上）。分母必须是正整数。 */
export function roundDiv(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new QuoteError("BAD_DIV", "金额运算无效");
  }
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

export function computeQuote(input: QuoteInput): QuoteResult {
  if (!Array.isArray(input.lines)) {
    throw new QuoteError("BAD_LINES", "用豆明细无效");
  }
  if (input.lines.length > 256) {
    throw new QuoteError("BAD_LINES", "颜色种类过多");
  }
  assertInt(input.wasteHundredths, "BAD_WASTE", "损耗必须是 0% 到 100% 之间的数", 0, 10000);
  assertInt(input.laborHourHundredths, "BAD_HOURS", "工时必须在 0 到 1000 小时之间", 0, 100_000);
  assertInt(input.hourlyRateCents, "BAD_RATE", "时薪无效", 0, MAX_CENTS);
  assertInt(input.packagingCents, "BAD_PACKAGING", "包装成本无效", 0, MAX_CENTS);
  assertInt(input.otherCents, "BAD_OTHER", "其他成本无效", 0, MAX_CENTS);
  assertInt(
    input.marginHundredths,
    "BAD_MARGIN",
    "目标毛利率必须大于等于 0% 且小于 100%。毛利率不是加价率。",
    0,
    9999,
  );
  assertInt(input.minProfitCents, "BAD_MIN_PROFIT", "最低利润无效", 0, MAX_CENTS);
  assertInt(input.minLaborFloorCents, "BAD_MIN_LABOR", "最低人工保底无效", 0, MAX_CENTS);
  if (input.finalPriceCents !== null) {
    assertInt(input.finalPriceCents, "BAD_FINAL", "最终报价必须是大于等于 0 的金额", 0, MAX_CENTS);
  }

  const lines: QuoteLine[] = [];
  let usedBeads = 0;
  let purchaseBeads = 0;
  let beadCostCents = 0;

  for (const line of input.lines) {
    if (typeof line.code !== "string" || typeof line.name !== "string") {
      throw new QuoteError("BAD_LINE", "颜色明细无效");
    }
    assertInt(line.usedBeads, "BAD_COUNT", "用量必须是非负整数", 0, MAX_BEADS);
    assertInt(line.unitPriceCents, "BAD_UNIT", "单价无效", 0, MAX_CENTS);
    const purchase = purchaseCount(line.usedBeads, input.wasteHundredths);
    const amountCents = purchase * line.unitPriceCents;
    if (!Number.isSafeInteger(amountCents) || amountCents > MAX_CENTS) {
      throw new QuoteError("BAD_AMOUNT", "豆材金额过大");
    }
    usedBeads += line.usedBeads;
    purchaseBeads += purchase;
    beadCostCents += amountCents;
    if (line.usedBeads > 0) {
      lines.push({
        code: line.code,
        name: line.name,
        usedBeads: line.usedBeads,
        purchaseBeads: purchase,
        unitPriceCents: line.unitPriceCents,
        amountCents,
      });
    }
  }

  if (!Number.isSafeInteger(usedBeads) || usedBeads > MAX_BEADS) {
    throw new QuoteError("BAD_COUNT", "用豆总数过大");
  }
  if (!Number.isSafeInteger(beadCostCents) || beadCostCents > MAX_CENTS) {
    throw new QuoteError("BAD_AMOUNT", "豆材金额过大");
  }

  const laborCostCents = roundDiv(input.laborHourHundredths * input.hourlyRateCents, 100);
  if (laborCostCents > MAX_CENTS) {
    throw new QuoteError("BAD_LABOR", "人工成本过大");
  }

  const totalCostCents = beadCostCents + laborCostCents + input.packagingCents + input.otherCents;
  if (!Number.isSafeInteger(totalCostCents) || totalCostCents > MAX_CENTS) {
    throw new QuoteError("BAD_TOTAL", "成本合计过大");
  }

  const marginPriceCents =
    totalCostCents === 0 ? 0 : roundDiv(totalCostCents * 10000, 10000 - input.marginHundredths);
  if (marginPriceCents > MAX_CENTS) {
    throw new QuoteError("BAD_PRICE", "按毛利率反推的售价过大，请调低毛利率或成本");
  }

  const minProfitPriceCents = input.minProfitCents > 0 ? totalCostCents + input.minProfitCents : null;
  if (minProfitPriceCents !== null && minProfitPriceCents > MAX_CENTS) {
    throw new QuoteError("BAD_PRICE", "最低利润抬高后的售价过大");
  }
  const minLaborPriceCents = input.minLaborFloorCents > 0 ? input.minLaborFloorCents : null;

  let suggestedPriceCents = marginPriceCents;
  let basis: QuoteBasis = "margin";
  if (minProfitPriceCents !== null && minProfitPriceCents > suggestedPriceCents) {
    suggestedPriceCents = minProfitPriceCents;
    basis = "minProfit";
  }
  if (minLaborPriceCents !== null && minLaborPriceCents > suggestedPriceCents) {
    suggestedPriceCents = minLaborPriceCents;
    basis = "minLabor";
  }

  const finalPriceCents = input.finalPriceCents === null ? suggestedPriceCents : input.finalPriceCents;
  const profitCents = finalPriceCents - totalCostCents;
  const grossMarginBp = finalPriceCents > 0 ? roundDiv(profitCents * 10000, finalPriceCents) : null;
  const markupBp = totalCostCents > 0 ? roundDiv(profitCents * 10000, totalCostCents) : null;

  return {
    lines,
    usedBeads,
    purchaseBeads,
    beadCostCents,
    laborCostCents,
    packagingCents: input.packagingCents,
    otherCents: input.otherCents,
    totalCostCents,
    marginPriceCents,
    minProfitPriceCents,
    minLaborPriceCents,
    suggestedPriceCents,
    basis,
    finalPriceCents,
    profitCents,
    grossMarginBp,
    markupBp,
  };
}

export function basisLabel(basis: QuoteBasis): string {
  switch (basis) {
    case "margin":
      return "按目标毛利率反推";
    case "minProfit":
      return "被最低利润抬高";
    case "minLabor":
      return "被最低人工保底抬高";
  }
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function stripNumber(raw: string): string {
  return raw.trim().replace(/，/g, "").replace(/,/g, "").replace(/元/g, "").replace(/%/g, "").replace(/^¥/, "");
}

function parseDecimalScaled(
  raw: string,
  label: string,
  decimals: number,
  maxScaled: number,
): ParseResult<number> {
  const text = stripNumber(raw);
  if (!text) return { ok: false, message: `请填写${label}` };
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { ok: false, message: `${label}要填大于等于 0 的数字` };
  }
  const [wholeRaw, fracRaw = ""] = text.split(".");
  if (wholeRaw.length > 12) return { ok: false, message: `${label}过大` };
  const scale = 10 ** decimals;
  let scaled = Number(wholeRaw) * scale;
  const kept = fracRaw.slice(0, decimals);
  if (kept.length > 0) scaled += Number(kept.padEnd(decimals, "0"));
  const extra = fracRaw.length > decimals ? Number(fracRaw[decimals]) : 0;
  if (extra >= 5) scaled += 1;
  if (!Number.isSafeInteger(scaled) || scaled > maxScaled) {
    return { ok: false, message: `${label}过大` };
  }
  return { ok: true, value: scaled };
}

export function parseYuanToCents(raw: string, label: string): ParseResult<number> {
  return parseDecimalScaled(raw, label, 2, 100_000_000);
}

export function parseWastePercent(raw: string): ParseResult<number> {
  const parsed = parseDecimalScaled(raw, "损耗", 2, 1_000_000);
  if (!parsed.ok) return parsed;
  if (parsed.value > 10000) {
    return { ok: false, message: "损耗只能在 0% 到 100% 之间" };
  }
  return parsed;
}

export function parseHours(raw: string): ParseResult<number> {
  const parsed = parseDecimalScaled(raw, "工时", 2, 1_000_000_000);
  if (!parsed.ok) return parsed;
  if (parsed.value > 100_000) {
    return { ok: false, message: "工时只能在 0 到 1000 小时之间" };
  }
  return parsed;
}

export function parseGrossMarginPercent(raw: string): ParseResult<number> {
  const parsed = parseDecimalScaled(raw, "目标毛利率", 2, 1_000_000);
  if (!parsed.ok) return parsed;
  if (parsed.value >= 10000) {
    return {
      ok: false,
      message:
        "目标毛利率必须小于 100%。毛利率不是加价率：填 40 表示售价里有 40% 是毛利。成本 60 元、毛利率 40% 时，建议售价是 100 元，而不是 60×1.4=84 元。",
    };
  }
  return parsed;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

/** 4000 → 40.00%。单位是百分数的百分位。 */
export function formatBp(bp: number): string {
  const sign = bp < 0 ? "-" : "";
  const abs = Math.abs(bp);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}%`;
}
