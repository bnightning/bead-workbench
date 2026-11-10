import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING_FIELDS, normalizePricing, tryBuildQuote } from "./quoteForm.ts";

describe("从表单到报价", () => {
  it("默认示例参数能算出含损耗、人工和包装的建议售价", () => {
    const result = tryBuildQuote({
      counts: [{ code: "R1", name: "朱砂", count: 10 }],
      fields: DEFAULT_PRICING_FIELDS,
      overrides: {},
      finalRaw: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.lines[0]?.purchaseBeads).toBe(11);
    expect(result.quote.beadCostCents).toBe(55);
    expect(result.quote.laborCostCents).toBe(2500);
    expect(result.quote.packagingCents).toBe(150);
    expect(result.quote.totalCostCents).toBe(2705);
    expect(result.quote.suggestedPriceCents).toBe(4508);
    expect(result.quote.basis).toBe("margin");
    expect(result.quote.grossMarginBp).not.toBe(result.quote.markupBp);
  });

  it("分色单价覆盖统一单价", () => {
    const result = tryBuildQuote({
      counts: [{ code: "R1", name: "朱砂", count: 2 }],
      fields: { ...DEFAULT_PRICING_FIELDS, waste: "0", hours: "0", packaging: "0", margin: "0" },
      overrides: { R1: "0.10" },
      finalRaw: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.beadCostCents).toBe(20);
    expect(result.quote.totalCostCents).toBe(20);
  });

  it("非法毛利率不会算出建议售价", () => {
    const result = tryBuildQuote({
      counts: [{ code: "R1", name: "朱砂", count: 2 }],
      fields: { ...DEFAULT_PRICING_FIELDS, margin: "120" },
      overrides: {},
      finalRaw: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("加价率");
  });

  it("自动估算只按豆数计算工时，不把手动工时再加一次", () => {
    const result = tryBuildQuote({
      counts: [{ code: "R1", name: "朱砂", count: 256 }],
      fields: {
        ...DEFAULT_PRICING_FIELDS,
        laborMode: "auto",
        hours: "9",
        margin: "0",
        waste: "0",
        packaging: "0",
        unitPrice: "0",
      },
      overrides: {},
      finalRaw: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.labor.source).toBe("auto");
    expect(result.labor.laborHourHundredths).toBe(127);
    expect(result.quote.laborCostCents).toBe(3175);
    expect(result.quote.totalCostCents).toBe(3175);
  });

  it("手动模式保留手填工时，估算失败也不改报价", () => {
    const result = tryBuildQuote({
      counts: [{ code: "R1", name: "朱砂", count: 256 }],
      fields: { ...DEFAULT_PRICING_FIELDS, laborMode: "manual", hours: "2", beadsPerHour: "0", margin: "0", waste: "0", packaging: "0" },
      overrides: {},
      finalRaw: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.labor.source).toBe("manual");
    expect(result.labor.estimate).toBeNull();
    expect(result.quote.laborCostCents).toBe(5000);
  });

  it("旧方案没有工时来源时按手动工时恢复，不改成自动估算", () => {
    const restored = normalizePricing({ hours: "2.50", hourly: "25", margin: "0", waste: "0", packaging: "0", unitPrice: "0", other: "0", minProfit: "0", minLabor: "0" });
    expect(restored.laborMode).toBe("manual");
    expect(restored.hours).toBe("2.50");
    const result = tryBuildQuote({
      counts: [{ code: "R1", name: "朱砂", count: 256 }],
      fields: restored,
      overrides: {},
      finalRaw: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.laborCostCents).toBe(6250);
    expect(result.labor.laborHourHundredths).toBe(250);
  });
});
