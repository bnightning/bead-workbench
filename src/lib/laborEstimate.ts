import { roundDiv } from "./pricing.ts";

/** 新会话的示例假设。旧方案没有这些字段时不会拿它们改写已保存的工时。 */
export const DEFAULT_BEADS_PER_HOUR = "300";
export const DEFAULT_PREP_MINUTES = "10";
export const DEFAULT_FINISH_MINUTES = "15";

export const LABOR_ESTIMATE_NOTE =
  "300 颗/小时、准备 10 分钟、熨烫整理 15 分钟只是示例假设，不是实测速度，也不承诺这张作品实际要做这么久。估算不按颜色数或图案复杂度加系数。";

const MAX_BEADS = 10_000_000;
const MAX_SPEED_HUNDREDTHS = 10_000_000;
const MAX_MINUTE_HUNDREDTHS = 144_000;
const MAX_HOUR_HUNDREDTHS = 100_000;

export class LaborError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LaborError";
    this.code = code;
  }
}

export interface LaborEstimate {
  usedBeads: number;
  /** 30000 表示 300.00 颗/小时 */
  beadsPerHourHundredths: number;
  /** 以下都是「分钟的百分位」，5120 表示 51.20 分钟 */
  beadMinuteHundredths: number;
  prepMinuteHundredths: number;
  finishMinuteHundredths: number;
  totalMinuteHundredths: number;
  /** 小时的百分位，127 表示 1.27 小时，与人工成本使用的工时相同 */
  laborHourHundredths: number;
}

export function estimateLabor(input: {
  usedBeads: number;
  beadsPerHourHundredths: number;
  prepMinuteHundredths: number;
  finishMinuteHundredths: number;
}): LaborEstimate {
  if (!Number.isInteger(input.usedBeads) || input.usedBeads < 0 || input.usedBeads > MAX_BEADS) {
    throw new LaborError("BAD_COUNT", "有效豆数必须是非负整数");
  }
  if (!Number.isInteger(input.beadsPerHourHundredths) || input.beadsPerHourHundredths <= 0 || input.beadsPerHourHundredths > MAX_SPEED_HUNDREDTHS) {
    throw new LaborError("BAD_SPEED", "拼豆速度必须大于 0。速度为 0 时无法按颗计算耗时。");
  }
  for (const value of [input.prepMinuteHundredths, input.finishMinuteHundredths]) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_MINUTE_HUNDREDTHS) {
      throw new LaborError("BAD_MINUTES", "准备和熨烫整理只能在 0 到 1440 分钟之间");
    }
  }

  const beadMinuteHundredths =
    input.usedBeads === 0 ? 0 : roundDiv(input.usedBeads * 600_000, input.beadsPerHourHundredths);
  const totalMinuteHundredths = beadMinuteHundredths + input.prepMinuteHundredths + input.finishMinuteHundredths;
  const laborHourHundredths = roundDiv(totalMinuteHundredths, 60);
  if (!Number.isSafeInteger(laborHourHundredths) || laborHourHundredths > MAX_HOUR_HUNDREDTHS) {
    throw new LaborError("BAD_HOURS", "按这个速度估算超过 1000 小时。请提高每小时颗数，或改用手动工时。");
  }

  return {
    usedBeads: input.usedBeads,
    beadsPerHourHundredths: input.beadsPerHourHundredths,
    beadMinuteHundredths,
    prepMinuteHundredths: input.prepMinuteHundredths,
    finishMinuteHundredths: input.finishMinuteHundredths,
    totalMinuteHundredths,
    laborHourHundredths,
  };
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function parseScaled(raw: string, label: string, decimals: number, maxScaled: number): ParseResult<number> {
  const text = raw.trim().replace(/，/g, "").replace(/,/g, "").replace(/颗\/小时|颗|分钟/g, "");
  if (!text) return { ok: false, message: `请填写${label}` };
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { ok: false, message: `${label}要填大于等于 0 的数字` };
  }
  const [wholeRaw, fracRaw = ""] = text.split(".");
  if ((wholeRaw ?? "").length > 12) return { ok: false, message: `${label}过大` };
  const scale = 10 ** decimals;
  let scaled = Number(wholeRaw) * scale;
  const kept = fracRaw.slice(0, decimals);
  if (kept.length > 0) scaled += Number(kept.padEnd(decimals, "0"));
  const extra = fracRaw.length > decimals ? Number(fracRaw[decimals]) : 0;
  if (extra >= 5) scaled += 1;
  if (!Number.isSafeInteger(scaled) || scaled > maxScaled) return { ok: false, message: `${label}过大` };
  return { ok: true, value: scaled };
}

/** 返回颗/小时的百分位。0、负数、空值和无穷大都会被拒绝。 */
export function parseBeadsPerHour(raw: string): ParseResult<number> {
  const parsed = parseScaled(raw, "拼豆速度", 2, MAX_SPEED_HUNDREDTHS);
  if (!parsed.ok) {
    if (raw.trim() === "Infinity" || raw.trim() === "NaN" || raw.trim() === "-Infinity") {
      return { ok: false, message: "拼豆速度要填大于 0 的数字" };
    }
    return { ok: false, message: parsed.message.replace("大于等于 0", "大于 0") };
  }
  if (parsed.value <= 0) {
    return { ok: false, message: "拼豆速度必须大于 0。速度为 0 时无法按颗计算耗时。" };
  }
  return parsed;
}

export function parseFixedMinutes(raw: string, label: string): ParseResult<number> {
  const parsed = parseScaled(raw, label, 2, 10_000_000);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (parsed.value > MAX_MINUTE_HUNDREDTHS) {
    return { ok: false, message: `${label}只能在 0 到 1440 分钟之间` };
  }
  return parsed;
}

export function formatScaled(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

/** 76.20 分钟显示为「1 小时 16.20 分钟」，不把分以下的余数抹掉。 */
export function formatDuration(totalMinuteHundredths: number): string {
  const whole = Math.floor(totalMinuteHundredths / 100);
  const frac = String(totalMinuteHundredths % 100).padStart(2, "0");
  const hours = Math.floor(whole / 60);
  const minutes = whole % 60;
  if (hours === 0) return `${minutes}.${frac} 分钟`;
  return `${hours} 小时 ${minutes}.${frac} 分钟`;
}

export function laborBasisText(estimate: LaborEstimate): string {
  const speed = formatScaled(estimate.beadsPerHourHundredths);
  return `${estimate.usedBeads} 颗 ÷ ${speed} 颗/小时 = ${formatScaled(estimate.beadMinuteHundredths)} 分钟；准备 ${formatScaled(estimate.prepMinuteHundredths)} 分钟；熨烫整理 ${formatScaled(estimate.finishMinuteHundredths)} 分钟。合计 ${formatScaled(estimate.totalMinuteHundredths)} 分钟，即 ${formatScaled(estimate.laborHourHundredths)} 小时（${formatDuration(estimate.totalMinuteHundredths)}）。`;
}
