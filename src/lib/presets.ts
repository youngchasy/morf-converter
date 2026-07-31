import type { ConversionOptions, ConversionPreset } from "../types";

const STORAGE_KEY = "morf.conversion-presets.v1";

export function loadPresets(): ConversionPreset[] {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    const parsed = value ? (JSON.parse(value) as ConversionPreset[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePresets(presets: ConversionPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function createPreset(
  name: string,
  targetFormat: string,
  options: ConversionOptions
): ConversionPreset {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || `Пресет ${targetFormat.toUpperCase()}`,
    targetFormat,
    options: { ...options },
    createdAt: new Date().toISOString()
  };
}
