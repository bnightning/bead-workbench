import { describe, expect, it } from "vitest";
import { computeQuote } from "./pricing.ts";
import {
  LaborError,
  estimateLabor,
  formatDuration,
  formatScaled,
  parseBeadsPerHour,
  parseFixedMinutes,
} from "./laborEstimate.ts";

describe("预计制作工时", () => {
  it("256 颗、300 颗/小时、准备 10 分钟、熨烫 15 分钟，合计 1.27 小时", () => {
    const estimate = estimateLabor({
      usedBeads: 256,
      beadsPerHourHundredths: 30_000,
      prepMinuteHundredths: 1_000,
      finishMinuteHundredths: 1_500,
    });
    expect(estimate.beadMinuteHundredths).toBe(5_120);
    expect(estimate.totalMinuteHundredths).toBe(7_620);
    expect(estimate.laborHourHundredths).toBe(127);
    expect(formatScaled(estimate.laborHourHundredths)).toBe("1.27");
    expect(formatDuration(estimate.totalMinuteHundredths)).toBe("1 小时 16.20 分钟");
  });

  it("人工成本使用同一工时百分位，不按取整后的整分钟重算", () => {
    const estimate = estimateLabor({
      usedBeads: 1,
      beadsPerHourHundredths: 30_000,
      prepMinuteHundredths: 1_000,
      finishMinuteHundredths: 1_500,
    });
    expect(estimate.beadMinuteHundredths).toBe(20);
    expect(estimate.laborHourHundredths).toBe(42);
    const quote = computeQuote({
      lines: [],
      wasteHundredths: 0,
      laborHourHundredths: estimate.laborHourHundredths,
      hourlyRateCents: 2_500,
      packagingCents: 0,
      otherCents: 0,
      marginHundredths: 0,
      minProfitCents: 0,
      minLaborFloorCents: 0,
      finalPriceCents: null,
    });
    expect(quote.laborCostCents).toBe(1_050);
    expect(quote.totalCostCents).toBe(1_050);
  });

  it("没有豆子时只保留准备和熨烫，不出现除零", () => {
    const estimate = estimateLabor({
      usedBeads: 0,
      beadsPerHourHundredths: 30_000,
      prepMinuteHundredths: 1_000,
      finishMinuteHundredths: 1_500,
    });
    expect(estimate.beadMinuteHundredths).toBe(0);
    expect(estimate.totalMinuteHundredths).toBe(2_500);
    expect(estimate.laborHourHundredths).toBe(42);
  });

  it("速度为 0、负数或非有限数时拒绝", () => {
    expect(() =>
      estimateLabor({
        usedBeads: 10,
        beadsPerHourHundredths: 0,
        prepMinuteHundredths: 0,
        finishMinuteHundredths: 0,
      }),
    ).toThrow(LaborError);
    expect(parseBeadsPerHour("0").ok).toBe(false);
    expect(parseBeadsPerHour("-3").ok).toBe(false);
    expect(parseBeadsPerHour("Infinity").ok).toBe(false);
    expect(parseBeadsPerHour("NaN").ok).toBe(false);
    expect(parseBeadsPerHour("").ok).toBe(false);
    expect(parseBeadsPerHour("300")).toEqual({ ok: true, value: 30_000 });
    const zeroish = parseBeadsPerHour("0.001");
    expect(zeroish.ok).toBe(false);
  });

  it("固定分钟超出范围或估算超过 1000 小时时拒绝", () => {
    expect(parseFixedMinutes("-1", "准备").ok).toBe(false);
    expect(parseFixedMinutes("1441", "熨烫整理").ok).toBe(false);
    expect(parseFixedMinutes("15", "熨烫整理")).toEqual({ ok: true, value: 1_500 });
    expect(() =>
      estimateLabor({
        usedBeads: 400_000,
        beadsPerHourHundredths: 100,
        prepMinuteHundredths: 0,
        finishMinuteHundredths: 0,
      }),
    ).toThrow(LaborError);
  });
});
