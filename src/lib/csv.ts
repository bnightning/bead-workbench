const DANGEROUS_START = /^[=+\-@\t\r]/;

/** 防止电子表格把以 =、+、-、@ 开头的单元格当成公式。 */
export function sanitizeCsvCell(value: string | number): string {
  let text = String(value);
  if (DANGEROUS_START.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export interface CsvBeadRow {
  code: string;
  name: string;
  hex: string;
  used: number;
  purchase: number;
  unitYuan: string;
  amountYuan: string;
}

export interface CsvLabor {
  sourceLabel: string;
  chargedHours: string;
  speed: string;
  prepMinutes: string;
  finishMinutes: string;
  beadMinutes: string;
  totalMinutes: string;
  laborYuan: string;
  note: string;
}

export function buildBeadCsv(input: {
  rows: CsvBeadRow[];
  usedTotal: number;
  purchaseTotal: number;
  beadCostYuan: string;
  note: string;
  labor?: CsvLabor | null;
}): string {
  const header = ["颜色代号", "颜色名称", "HEX", "用量颗数", "含损耗采购颗数", "单价（元）", "金额（元）"];
  const lines = [
    "sep=,",
    header.map((cell) => sanitizeCsvCell(cell)).join(","),
    ...input.rows.map((row) =>
      [row.code, row.name, row.hex, row.used, row.purchase, row.unitYuan, row.amountYuan]
        .map((cell) => sanitizeCsvCell(cell))
        .join(","),
    ),
    ["合计", "", "", input.usedTotal, input.purchaseTotal, "", input.beadCostYuan]
      .map((cell) => sanitizeCsvCell(cell))
      .join(","),
  ];
  if (input.labor) {
    const laborRows: Array<[string, string]> = [
      ["工时来源", input.labor.sourceLabel],
      ["计入成本的工时（小时）", input.labor.chargedHours],
      ["拼豆速度（颗/小时）", input.labor.speed],
      ["准备（分钟）", input.labor.prepMinutes],
      ["熨烫整理（分钟）", input.labor.finishMinutes],
      ["拼豆耗时（分钟）", input.labor.beadMinutes],
      ["预计总分钟", input.labor.totalMinutes],
      ["人工成本（元）", input.labor.laborYuan],
      ["工时说明", input.labor.note],
    ];
    for (const [label, value] of laborRows) {
      lines.push([label, value, "", "", "", "", ""].map((cell) => sanitizeCsvCell(cell)).join(","));
    }
  }
  lines.push(["说明", input.note, "", "", "", "", ""].map((cell) => sanitizeCsvCell(cell)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
