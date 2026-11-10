import { describe, expect, it } from "vitest";
import { cellAtPoint } from "./boardLayout.ts";

describe("网格命中", () => {
  it("坐标轴空白处没有格子，格子内能对上列和行", () => {
    expect(cellAtPoint(4, 4, 10, 8, 14)).toBeNull();
    const hit = cellAtPoint(28 + 14 + 1, 28 + 2, 10, 8, 14);
    expect(hit).toEqual({ x: 1, y: 0 });
    expect(cellAtPoint(28 + 14 * 10, 28, 10, 8, 14)).toBeNull();
  });
});
