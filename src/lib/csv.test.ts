import { describe, expect, it } from "vitest";
import { buildBeadCsv, sanitizeCsvCell } from "./csv.ts";

describe("CSV 公式注入", () => {
  it("给危险开头加单引号，并转义引号和逗号", () => {
    expect(sanitizeCsvCell("=1+1")).toBe("'=1+1");
    expect(sanitizeCsvCell("+cmd")).toBe("'+cmd");
    expect(sanitizeCsvCell("-2+3")).toBe("'-2+3");
    expect(sanitizeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sanitizeCsvCell("\t=1")).toBe("'\t=1");
    expect(sanitizeCsvCell("R1")).toBe("R1");
    expect(sanitizeCsvCell(12)).toBe("12");
    expect(sanitizeCsvCell("你好,世界")).toBe('"你好,世界"');
    expect(sanitizeCsvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
  });

  it("清单带 BOM、表头、合计，并把危险颜色名写成文本", () => {
    const csv = buildBeadCsv({
      rows: [
        {
          code: "=1+1",
          name: "=HYPERLINK(\"http://evil\")",
          hex: "#FF0000",
          used: 3,
          purchase: 4,
          unitYuan: "0.05",
          amountYuan: "0.20",
        },
      ],
      usedTotal: 3,
      purchaseTotal: 4,
      beadCostYuan: "0.20",
      note: "示例色板，不是客户订单",
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.startsWith("\uFEFFsep=,\r\n")).toBe(true);
    expect(csv).toContain("颜色代号,颜色名称,HEX,用量颗数,含损耗采购颗数,单价（元）,金额（元）");
    expect(csv).toContain("'=1+1");
    expect(csv).not.toContain(",=HYPERLINK");
    expect(csv).toContain("#FF0000,3,4,0.05,0.20");
    expect(csv).toContain("合计,,,3,4,,0.20");
    expect(csv).toContain("不是客户订单");
  });

  it("写出工时来源和参数，并挡住说明里的公式", () => {
    const csv = buildBeadCsv({
      rows: [],
      usedTotal: 256,
      purchaseTotal: 277,
      beadCostYuan: "13.85",
      note: "示例",
      labor: {
        sourceLabel: "自动估算",
        chargedHours: "1.27",
        speed: "300",
        prepMinutes: "10.00",
        finishMinutes: "15.00",
        beadMinutes: "51.20",
        totalMinutes: "76.20",
        laborYuan: "31.75",
        note: "=CMD()",
      },
    });
    expect(csv).toContain("工时来源,自动估算");
    expect(csv).toContain("计入成本的工时（小时）,1.27");
    expect(csv).toContain("拼豆速度（颗/小时）,300");
    expect(csv).toContain("人工成本（元）,31.75");
    expect(csv).toContain("'=CMD()");
    expect(csv).not.toContain(",=CMD()");
  });
});
