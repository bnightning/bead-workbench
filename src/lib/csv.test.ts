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
});
