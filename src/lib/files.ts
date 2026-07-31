import type { WorkFile } from "../types";
import { kindFromExtension } from "./catalog";

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function extensionOf(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function mockFile(path: string, size = 0): WorkFile {
  const extension = extensionOf(path);
  return {
    id: crypto.randomUUID(),
    path,
    name: basename(path),
    extension,
    size,
    kind: kindFromExtension(extension),
    status: "ready"
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "размер неизвестен";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const order = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** order;
  return `${value >= 10 || order === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[order]}`;
}

export function uniqueByPath(files: WorkFile[]): WorkFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = file.path.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
