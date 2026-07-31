import type { OperationRecord } from "../types";

const HISTORY_KEY = "morf.operation-history.v1";
const HISTORY_LIMIT = 40;

export function loadHistory(): OperationRecord[] {
  try {
    const value = localStorage.getItem(HISTORY_KEY);
    return value ? (JSON.parse(value) as OperationRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(history: OperationRecord[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
}

export function makeRecord(
  type: OperationRecord["type"],
  title: string,
  summary: string,
  outputs: string[],
  success: boolean
): OperationRecord {
  return {
    id: crypto.randomUUID(),
    type,
    title,
    summary,
    outputs,
    success,
    createdAt: new Date().toISOString()
  };
}
