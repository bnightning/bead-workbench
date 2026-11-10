import type { ColorCount } from "./grid.ts";
import {
  QuoteError,
  computeQuote,
  parseGrossMarginPercent,
  parseHours,
  parseWastePercent,
  parseYuanToCents,
  type QuoteResult,
} from "./pricing.ts";

export interface PricingFields {
  unitPrice: string;
  waste: string;
  hours: string;
  hourly: string;
  packaging: string;
  other: string;
  margin: string;
  minProfit: string;
  minLabor: string;
}

export const DEFAULT_PRICING_FIELDS: PricingFields = {
  unitPrice: "0.05",
  waste: "8",
  hours: "1",
  hourly: "25",
  packaging: "1.50",
  other: "0",
  margin: "40",
  minProfit: "0",
  minLabor: "0",
};

export const PRICING_ASSUMPTION =
  "默认的 0.05 元/颗、25 元/小时、1.50 元包装和 40% 毛利率只是方便试算的假设，请改成你自己的成本。这不是市场报价，也不能当作给顾客的成交价。";

export function tryBuildQuote(input: {
  counts: Array<Pick<ColorCount, "code" | "name" | "count">>;
  fields: PricingFields;
  overrides: Record<string, string>;
  finalRaw: string | null;
}): { ok: true; quote: QuoteResult } | { ok: false; message: string } {
  const unit = parseYuanToCents(input.fields.unitPrice, "统一单价");
  if (!unit.ok) return unit;
  const waste = parseWastePercent(input.fields.waste);
  if (!waste.ok) return waste;
  const hours = parseHours(input.fields.hours);
  if (!hours.ok) return hours;
  const hourly = parseYuanToCents(input.fields.hourly, "时薪");
  if (!hourly.ok) return hourly;
  const packaging = parseYuanToCents(input.fields.packaging, "包装");
  if (!packaging.ok) return packaging;
  const other = parseYuanToCents(input.fields.other, "其他成本");
  if (!other.ok) return other;
  const margin = parseGrossMarginPercent(input.fields.margin);
  if (!margin.ok) return margin;
  const minProfit = parseYuanToCents(input.fields.minProfit, "最低利润");
  if (!minProfit.ok) return minProfit;
  const minLabor = parseYuanToCents(input.fields.minLabor, "最低人工保底");
  if (!minLabor.ok) return minLabor;

  const lines = [];
  for (const count of input.counts) {
    const raw = input.overrides[count.code];
    const parsed = raw && raw.trim() ? parseYuanToCents(raw, `${count.code} 单价`) : unit;
    if (!parsed.ok) return parsed;
    lines.push({
      code: count.code,
      name: count.name,
      usedBeads: count.count,
      unitPriceCents: parsed.value,
    });
  }

  let finalPriceCents: number | null = null;
  if (input.finalRaw !== null) {
    const finalPrice = parseYuanToCents(input.finalRaw, "最终报价");
    if (!finalPrice.ok) return finalPrice;
    finalPriceCents = finalPrice.value;
  }

  try {
    return {
      ok: true,
      quote: computeQuote({
        lines,
        wasteHundredths: waste.value,
        laborHourHundredths: hours.value,
        hourlyRateCents: hourly.value,
        packagingCents: packaging.value,
        otherCents: other.value,
        marginHundredths: margin.value,
        minProfitCents: minProfit.value,
        minLaborFloorCents: minLabor.value,
        finalPriceCents,
      }),
    };
  } catch (error) {
    if (error instanceof QuoteError) return { ok: false, message: error.message };
    throw error;
  }
}
