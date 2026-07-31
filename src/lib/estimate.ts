import type { ConversionOptions, WorkFile } from "../types";
import { formatBytes } from "./files";

const ratios: Record<string, number> = {
  png: 0.9,
  jpg: 0.22,
  jpeg: 0.22,
  webp: 0.16,
  avif: 0.12,
  gif: 0.45,
  bmp: 1.8,
  tiff: 1.2,
  mp4: 0.65,
  webm: 0.55,
  mkv: 0.7,
  mov: 0.75,
  mp3: 0.18,
  m4a: 0.16,
  aac: 0.15,
  opus: 0.12,
  ogg: 0.16,
  flac: 0.58,
  wav: 1.25,
  pdf: 0.85,
  txt: 0.08,
  json: 0.85,
  yaml: 0.92,
  toml: 0.9,
  csv: 0.72
};

export function estimateOutputBytes(
  files: WorkFile[],
  targetFormat: string,
  options: ConversionOptions
): number {
  const source = files.reduce((sum, file) => sum + file.size, 0);
  if (!source) return 0;
  let ratio = ratios[targetFormat.toLowerCase()] ?? 0.9;
  if (["jpg", "jpeg", "webp", "avif", "mp4", "webm", "mkv", "mov"].includes(targetFormat)) {
    ratio *= 0.55 + options.quality / 125;
  }
  if (options.width || options.height) ratio *= 0.72;
  if (options.grayscale) ratio *= 0.82;
  if (options.watermarkPath) ratio *= 1.03;
  return Math.max(1, Math.round(source * ratio));
}

export function estimateLabel(
  files: WorkFile[],
  targetFormat: string,
  options: ConversionOptions
): string {
  const bytes = estimateOutputBytes(files, targetFormat, options);
  return bytes ? `≈ ${formatBytes(bytes)}` : "—";
}
