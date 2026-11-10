export function axisGutter(cellSize: number): number {
  return Math.max(28, Math.round(cellSize * 1.6));
}

export function cellAtPoint(
  offsetX: number,
  offsetY: number,
  gridWidth: number,
  gridHeight: number,
  cellSize: number,
): { x: number; y: number } | null {
  const gutter = axisGutter(cellSize);
  const x = Math.floor((offsetX - gutter) / cellSize);
  const y = Math.floor((offsetY - gutter) / cellSize);
  if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return null;
  return { x, y };
}
