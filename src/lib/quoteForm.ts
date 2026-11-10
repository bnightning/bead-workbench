import type { ColorCount } from "./grid.ts";
import {
  DEFAULT_BEADS_PER_HOUR,
  DEFAULT_FINISH_MINUTES,
  DEFAULT_PREP_MINUTES,
  estimateLabor,
  parseBeadsPerHour,
  parseFixedMinutes,
  type LaborEstimate,
} from "./laborEstimate.ts";
import {
  QuoteError,
  computeQuote,
  parseGrossMarginPercent,
  parseHours,
  parseWastePercent,
  parseYuanToCents,
  type QuoteResult,
} from "./pricing.ts";

export type LaborMode = "auto" | "manual";

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
  /** 缺省视为 manual，避免旧方案被自动估算改价 */
  laborMode: LaborMode;
  beadsPerHour: string;
  prepMinutes: string;
  finishMinutes: string;
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
  laborMode: "manual",
  beadsPerHour: DEFAULT_BEADS_PER_HOUR,
  prepMinutes: DEFAULT_PREP_MINUTES,
  finishMinutes: DEFAULT_FINISH_MINUTES,
};

export function normalizePricing(input: Partial<PricingFields> | null | undefined): PricingFields {
  return {
    ...DEFAULT_PRICING_FIELDS,
    ...input,
    hours: input?.hours ?? DEFAULT_PRICING_FIELDS.hours,
    laborMode: input?.laborMode === "auto" ? "auto" : "manual",
    beadsPerHour: input?.beadsPerHour ?? DEFAULT_PRICING_FIELDS.beadsPerHour,
    prepMinutes: input?.prepMinutes ?? DEFAULT_PRICING_FIELDS.prepMinutes,
    finishMinutes: input?.finishMinutes ?? DEFAULT_PRICING_FIELDS.finishMinutes,
  };
}

export const PRICING_ASSUMPTION =
  "默认的 0.05 元/颗、25 元/小时、1.50 元包装和 40% 毛利率只是方便试算的假设，请改成你自己的成本。这不是市场报价，也不能当作给顾客的成交价。";

export interface ResolvedLabor {
  source: LaborMode;
  laborHourHundredths: number;
  estimate: LaborEstimate | null;
  estimateMessage: string | null;
}

export function resolveChargedLabor(input: {
  mode: LaborMode | undefined;
  usedBeads: number;
  manualHours: string;
  beadsPerHour: string;
  prepMinutes: string;
  finishMinutes: string;
}): { ok: true; labor: ResolvedLabor } | { ok: false; message: string; labor: null } {
  const mode: LaborMode = input.mode === "auto" ? "auto" : "manual";
  const speed = parseBeadsPerHour(input.beadsPerHour);
  const prep = parseFixedMinutes(input.prepMinutes, "准备");
  const finish = parseFixedMinutes(input.finishMinutes, "熨烫整理");
  let estimate: LaborEstimate | null = null;
  let estimateMessage: string | null = null;
  if (speed.ok && prep.ok && finish.ok) {
    try {
      estimate = estimateLabor({
        usedBeads: input.usedBeads,
        beadsPerHourHundredths: speed.value,
        prepMinuteHundredths: prep.value,
        finishMinuteHundredths: finish.value,
      });
    } catch (error) {
      estimateMessage = error instanceof Error ? error.message : "无法估算工时";
    }
  } else {
    estimateMessage = !speed.ok ? speed.message : !prep.ok ? prep.message : finish.ok ? null : finish.message;
  }

  if (mode === "manual") {
    const hours = parseHours(input.manualHours);
    if (!hours.ok) return { ok: false, message: hours.message, labor: null };
    return {
      ok: true,
      labor: { source: "manual", laborHourHundredths: hours.value, estimate, estimateMessage },
    };
  }

  if (!estimate) {
    return { ok: false, message: estimateMessage ?? "无法估算工时", labor: null };
  }
  return {
    ok: true,
    labor: { source: "auto", laborHourHundredths: estimate.laborHourHundredths, estimate, estimateMessage: null },
  };
}

export function tryBuildQuote(input: {
  counts: Array<Pick<ColorCount, "code" | "name" | "count">>;
  fields: PricingFields;
  overrides: Record<string, string>;
  finalRaw: string | null;
}): { ok: true; quote: QuoteResult; labor: ResolvedLabor } | { ok: false; message: string } {
  const usedBeads = input.counts.reduce((sum, count) => sum + count.count, 0);
  const labor = resolveChargedLabor({
    mode: input.fields.laborMode,
    usedBeads,
    manualHours: input.fields.hours,
    beadsPerHour: input.fields.beadsPerHour,
    prepMinutes: input.fields.prepMinutes,
    finishMinutes: input.fields.finishMinutes,
  });
  if (!labor.ok) return labor;
  const unit = parseYuanToCents(input.fields.unitPrice, "统一单价");
  if (!unit.ok) return unit;
  const waste = parseWastePercent(input.fields.waste);
  if (!waste.ok) return waste;
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
      labor: labor.labor,
      quote: computeQuote({
        lines,
        wasteHundredths: waste.value,
        laborHourHundredths: labor.labor.laborHourHundredths,
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
