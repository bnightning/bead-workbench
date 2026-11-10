import { describe, expect, it } from "vitest";
import { safeFileBase } from "./filename.ts";

describe("下载文件名", () => {
  it("去掉路径和公式字符，空名有兜底", () => {
    expect(safeFileBase("顾客图/山月.png")).toBe("顾客图 山月.png");
    expect(safeFileBase('=cmd?"a"')).toBe("=cmd a");
    expect(safeFileBase("   ")).toBe("未命名方案");
    expect(safeFileBase("甲".repeat(50))).toHaveLength(40);
  });
});
