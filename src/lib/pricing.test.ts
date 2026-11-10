import { describe, expect, it } from "vitest";
import {
  QuoteError,
  computeQuote,
  formatBp,
  formatCents,
  parseGrossMarginPercent,
  parseHours,
  parseWastePercent,
  parseYuanToCents,
  purchaseCount,
} from "./pricing.ts";

function quote(overrides: Partial<Parameters<typeof computeQuote>[0]> = {}) {
  return computeQuote({
    lines: [],
    wasteHundredths: 0,
    laborHourHundredths: 0,
    hourlyRateCents: 0,
    packagingCents: 0,
    otherCents: 0,
    marginHundredths: 0,
    minProfitCents: 0,
    minLaborFloorCents: 0,
    finalPriceCents: null,
    ...overrides,
  });
}

describe("采购颗数与损耗", () => {
  it("损耗为 0 时采购颗数等于用量", () => {
    expect(purchaseCount(10, 0)).toBe(10);
  });

  it("8% 损耗向上取整到整颗", () => {
    expect(purchaseCount(10, 800)).toBe(11);
  });

  it("正好整除时不再多加一颗", () => {
    expect(purchaseCount(10, 1000)).toBe(11);
  });

  it("100% 损耗变成两倍", () => {
    expect(purchaseCount(1, 10000)).toBe(2);
  });

  it("用量为 0 时不采购", () => {
    expect(purchaseCount(0, 800)).toBe(0);
  });

  it("拒绝超出 0% 到 100% 的损耗和负数用量", () => {
    expect(() => purchaseCount(1, 10001)).toThrow(QuoteError);
    expect(() => purchaseCount(1, -1)).toThrow(QuoteError);
    expect(() => purchaseCount(-1, 0)).toThrow(QuoteError);
  });
});

describe("成本、毛利率和加价率", () => {
  it("成本 60 元、毛利率 40% 时建议售价是 100 元，加价率不是 40%", () => {
    const result = quote({
      lines: [{ code: "R1", name: "朱砂", usedBeads: 1200, unitPriceCents: 5 }],
      marginHundredths: 4000,
    });
    expect(result.beadCostCents).toBe(6000);
    expect(result.totalCostCents).toBe(6000);
    expect(result.marginPriceCents).toBe(10000);
    expect(result.suggestedPriceCents).toBe(10000);
    expect(result.basis).toBe("margin");
    expect(result.finalPriceCents).toBe(10000);
    expect(result.profitCents).toBe(4000);
    expect(result.grossMarginBp).toBe(4000);
    expect(result.markupBp).toBe(6667);
    expect(result.grossMarginBp).not.toBe(result.markupBp);
  });

  it("毛利率为 0 时建议售价等于成本", () => {
    const result = quote({
      lines: [{ code: "K1", name: "松烟", usedBeads: 4, unitPriceCents: 25 }],
      marginHundredths: 0,
    });
    expect(result.totalCostCents).toBe(100);
    expect(result.suggestedPriceCents).toBe(100);
    expect(result.grossMarginBp).toBe(0);
    expect(result.markupBp).toBe(0);
  });

  it("分项相加得到成本合计", () => {
    const result = quote({
      lines: [{ code: "B2", name: "琉璃", usedBeads: 10, unitPriceCents: 10 }],
      wasteHundredths: 0,
      laborHourHundredths: 150,
      hourlyRateCents: 3000,
      packagingCents: 200,
      otherCents: 50,
      marginHundredths: 0,
    });
    expect(result.beadCostCents).toBe(100);
    expect(result.laborCostCents).toBe(4500);
    expect(result.totalCostCents).toBe(4850);
    expect(result.suggestedPriceCents).toBe(4850);
  });

  it("不同颜色各自向上取整，再乘各自单价", () => {
    const result = quote({
      lines: [
        { code: "A", name: "甲", usedBeads: 1, unitPriceCents: 100 },
        { code: "B", name: "乙", usedBeads: 1, unitPriceCents: 10 },
      ],
      wasteHundredths: 5000,
      marginHundredths: 0,
    });
    expect(result.lines.map((line) => line.purchaseBeads)).toEqual([2, 2]);
    expect(result.beadCostCents).toBe(220);
    expect(result.purchaseBeads).toBe(4);
    expect(result.usedBeads).toBe(2);
  });

  it("用量为 0 的颜色不进入明细", () => {
    const result = quote({
      lines: [
        { code: "A", name: "甲", usedBeads: 0, unitPriceCents: 100 },
        { code: "B", name: "乙", usedBeads: 3, unitPriceCents: 10 },
      ],
    });
    expect(result.lines).toHaveLength(1);
    expect(result.usedBeads).toBe(3);
  });

  it("最低利润在毛利率售价更低时抬高建议售价", () => {
    const result = quote({
      lines: [{ code: "A", name: "甲", usedBeads: 100, unitPriceCents: 100 }],
      marginHundredths: 1000,
      minProfitCents: 2000,
    });
    expect(result.totalCostCents).toBe(10000);
    expect(result.marginPriceCents).toBe(11111);
    expect(result.minProfitPriceCents).toBe(12000);
    expect(result.suggestedPriceCents).toBe(12000);
    expect(result.basis).toBe("minProfit");
  });

  it("最低人工保底是售价下限，0 表示不启用", () => {
    const raised = quote({
      lines: [{ code: "A", name: "甲", usedBeads: 1, unitPriceCents: 1000 }],
      minLaborFloorCents: 5000,
    });
    expect(raised.totalCostCents).toBe(1000);
    expect(raised.suggestedPriceCents).toBe(5000);
    expect(raised.basis).toBe("minLabor");

    const disabled = quote({
      lines: [{ code: "A", name: "甲", usedBeads: 1, unitPriceCents: 1000 }],
      minLaborFloorCents: 0,
      minProfitCents: 0,
    });
    expect(disabled.suggestedPriceCents).toBe(1000);
    expect(disabled.basis).toBe("margin");
  });

  it("毛利率售价更高时，保底不覆盖它", () => {
    const result = quote({
      lines: [{ code: "A", name: "甲", usedBeads: 100, unitPriceCents: 100 }],
      marginHundredths: 5000,
      minProfitCents: 3000,
      minLaborFloorCents: 5000,
    });
    expect(result.marginPriceCents).toBe(20000);
    expect(result.suggestedPriceCents).toBe(20000);
    expect(result.basis).toBe("margin");
  });

  it("保底和毛利率结果相同时，依据记为毛利率", () => {
    const result = quote({
      lines: [{ code: "A", name: "甲", usedBeads: 1, unitPriceCents: 100 }],
      marginHundredths: 0,
      minLaborFloorCents: 100,
    });
    expect(result.suggestedPriceCents).toBe(100);
    expect(result.basis).toBe("margin");
  });

  it("成本为 0 且没有保底时建议售价为 0，毛利率和加价率都无法计算", () => {
    const result = quote({ marginHundredths: 4000 });
    expect(result.suggestedPriceCents).toBe(0);
    expect(result.grossMarginBp).toBeNull();
    expect(result.markupBp).toBeNull();
  });

  it("成本为 0 时最低利润仍然生效，加价率无法计算", () => {
    const result = quote({ marginHundredths: 4000, minProfitCents: 1500 });
    expect(result.marginPriceCents).toBe(0);
    expect(result.suggestedPriceCents).toBe(1500);
    expect(result.basis).toBe("minProfit");
    expect(result.grossMarginBp).toBe(10000);
    expect(result.markupBp).toBeNull();
  });

  it("手改最终报价后，利润和比率按最终报价计算", () => {
    const result = quote({
      lines: [{ code: "A", name: "甲", usedBeads: 1, unitPriceCents: 10000 }],
      marginHundredths: 4000,
      finalPriceCents: 15000,
    });
    expect(result.suggestedPriceCents).toBe(16667);
    expect(result.finalPriceCents).toBe(15000);
    expect(result.profitCents).toBe(5000);
    expect(result.grossMarginBp).toBe(3333);
    expect(result.markupBp).toBe(5000);
  });

  it("最终报价低于成本时保留负利润", () => {
    const result = quote({
      lines: [{ code: "A", name: "甲", usedBeads: 1, unitPriceCents: 10000 }],
      finalPriceCents: 2500,
    });
    expect(result.profitCents).toBe(-7500);
    expect(result.grossMarginBp).toBe(-30000);
    expect(result.markupBp).toBe(-7500);
  });

  it("最终报价为 0 时不计算毛利率", () => {
    const result = quote({
      lines: [{ code: "A", name: "甲", usedBeads: 1, unitPriceCents: 100 }],
      finalPriceCents: 0,
    });
    expect(result.profitCents).toBe(-100);
    expect(result.grossMarginBp).toBeNull();
  });

  it("拒绝 100% 毛利率、负数和非法工时", () => {
    expect(() => quote({ marginHundredths: 10000 })).toThrow(QuoteError);
    expect(() => quote({ marginHundredths: -1 })).toThrow(QuoteError);
    expect(() => quote({ laborHourHundredths: -1 })).toThrow(QuoteError);
    expect(() => quote({ laborHourHundredths: 100_001 })).toThrow(QuoteError);
    expect(() => quote({ packagingCents: -5 })).toThrow(QuoteError);
    expect(() => quote({ finalPriceCents: -1 })).toThrow(QuoteError);
    expect(() => quote({ lines: [{ code: "A", name: "甲", usedBeads: 1.5, unitPriceCents: 1 }] })).toThrow(
      QuoteError,
    );
  });
});

describe("金额和百分比输入", () => {
  it("按分解析金额，不走二进制小数", () => {
    expect(parseYuanToCents("1.01", "单价")).toEqual({ ok: true, value: 101 });
    expect(parseYuanToCents("0.1", "单价")).toEqual({ ok: true, value: 10 });
    expect(parseYuanToCents("¥0.05元", "单价")).toEqual({ ok: true, value: 5 });
    expect(parseYuanToCents("100", "单价")).toEqual({ ok: true, value: 10000 });
    expect(parseYuanToCents("1.005", "单价")).toEqual({ ok: true, value: 101 });
  });

  it("拒绝空值、负数和非数字金额", () => {
    expect(parseYuanToCents("", "统一单价").ok).toBe(false);
    expect(parseYuanToCents("-1", "统一单价").ok).toBe(false);
    expect(parseYuanToCents("abc", "统一单价").ok).toBe(false);
    expect(parseYuanToCents("1.2.3", "统一单价").ok).toBe(false);
  });

  it("损耗允许 0 到 100，包括两端", () => {
    expect(parseWastePercent("8")).toEqual({ ok: true, value: 800 });
    expect(parseWastePercent("8.5%")).toEqual({ ok: true, value: 850 });
    expect(parseWastePercent("0")).toEqual({ ok: true, value: 0 });
    expect(parseWastePercent("100")).toEqual({ ok: true, value: 10000 });
    expect(parseWastePercent("100.01").ok).toBe(false);
    expect(parseWastePercent("-1").ok).toBe(false);
  });

  it("工时最多 1000，保留两位小数", () => {
    expect(parseHours("1.5")).toEqual({ ok: true, value: 150 });
    expect(parseHours("1000")).toEqual({ ok: true, value: 100000 });
    expect(parseHours("1000.01").ok).toBe(false);
  });

  it("毛利率小于 100，并说明它不是加价率", () => {
    expect(parseGrossMarginPercent("40")).toEqual({ ok: true, value: 4000 });
    expect(parseGrossMarginPercent("40%")).toEqual({ ok: true, value: 4000 });
    expect(parseGrossMarginPercent("99.99")).toEqual({ ok: true, value: 9999 });
    expect(parseGrossMarginPercent("0")).toEqual({ ok: true, value: 0 });
    const rejected = parseGrossMarginPercent("100");
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.message).toContain("加价率");
      expect(rejected.message).toContain("100 元");
    }
    expect(parseGrossMarginPercent("-5").ok).toBe(false);
  });

  it("格式化金额和百分数", () => {
    expect(formatCents(10000)).toBe("100.00");
    expect(formatCents(10)).toBe("0.10");
    expect(formatCents(-1234)).toBe("-12.34");
    expect(formatCents(0)).toBe("0.00");
    expect(formatBp(4000)).toBe("40.00%");
    expect(formatBp(6667)).toBe("66.67%");
    expect(formatBp(-30000)).toBe("-300.00%");
  });
});
