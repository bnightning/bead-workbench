export function safeFileBase(name: string): string {
  const cleaned = name.replace(/[\\/:*?\"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  const base = cleaned.slice(0, 40).trim();
  return base || "未命名方案";
}
