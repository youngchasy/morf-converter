export type WorkspaceId = "convert" | "combine" | "split" | "tools" | "history";

export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "pdf"
  | "data"
  | "archive"
  | "unknown";

export type JobStatus = "ready" | "working" | "done" | "error";

export interface WorkFile {
  id: string;
  path: string;
  name: string;
  extension: string;
  size: number;
  kind: FileKind;
  detail?: string;
  pageCount?: number;
  status: JobStatus;
  error?: string;
}

export interface EngineInfo {
  id: string;
  name: string;
  installed: boolean;
  version?: string;
  path?: string;
  description: string;
  formats: string[];
}

export interface FormatItem {
  extension: string;
  label: string;
  kind: FileKind;
  engine:
    | "native"
    | "ffmpeg"
    | "libreoffice"
    | "pandoc"
    | "qpdf"
    | "poppler"
    | "7zip";
}

export interface ConversionOptions {
  quality: number;
  width?: number;
  height?: number;
  fit: "contain" | "cover" | "stretch";
  rotation: 0 | 90 | 180 | 270;
  grayscale: boolean;
  preserveMetadata: boolean;
  audioBitrate: number;
  trimStart?: number;
  trimDuration?: number;
  hardwareEncoder: "software" | "auto" | "nvenc" | "videotoolbox" | "qsv" | "amf";
  watermarkPath?: string;
  watermarkOpacity: number;
  watermarkScale: number;
  watermarkPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  subtitlePath?: string;
  subtitleMode: "off" | "mux" | "burn";
}

export interface ConversionRequest {
  inputs: string[];
  outputDir: string;
  targetFormat: string;
  overwrite: boolean;
  options: ConversionOptions;
}

export interface JobResult {
  input: string;
  output?: string;
  success: boolean;
  message?: string;
}

export interface BatchResult {
  items: JobResult[];
  outputDir: string;
}

export interface CombineItem {
  id: string;
  path: string;
  name: string;
  extension: string;
  kind: FileKind;
  pageRange: string;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
  margin: number;
  offsetX: number;
  offsetY: number;
  borderWidth: number;
  borderColor: string;
  fit: "contain" | "cover" | "original";
}

export interface CombineRequest {
  items: CombineItem[];
  outputPath: string;
  mode: "lossless" | "layout";
  pagePreset: "a4" | "letter" | "source";
  orientation: "portrait" | "landscape";
  background: string;
  quality: number;
  dpi: number;
}

export interface SplitRequest {
  input: string;
  outputDir: string;
  mode: "pages" | "tiles" | "duration" | "render";
  targetFormat: string;
  rows: number;
  columns: number;
  pagesPerFile: number;
  segmentSeconds: number;
  dpi: number;
  quality: number;
}

export interface OperationRecord {
  id: string;
  type: "convert" | "combine" | "split";
  title: string;
  summary: string;
  createdAt: string;
  outputs: string[];
  success: boolean;
}

export type BackgroundJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed";

export interface JobSnapshot {
  id: string;
  operation: string;
  status: BackgroundJobStatus;
  progress: number;
  completed: number;
  total: number;
  currentFile?: string;
  message?: string;
  result?: BatchResult;
  createdAt: number;
}

export interface AppSettings {
  maxParallelJobs: number;
  enginePaths: Record<string, string>;
  hardwareEncoder: ConversionOptions["hardwareEncoder"];
}

export interface EngineInstallPlan {
  engineId: string;
  title: string;
  command: string;
  website: string;
  note: string;
}

export interface ConversionPreset {
  id: string;
  name: string;
  targetFormat: string;
  options: ConversionOptions;
  createdAt: string;
}

export interface OcrRequest {
  input: string;
  outputDir: string;
  language: string;
  outputFormat: "txt" | "pdf";
}

export interface ArchiveCreateRequest {
  inputs: string[];
  outputPath: string;
  format: "zip" | "7z";
}

export interface ArchiveExtractRequest {
  input: string;
  outputDir: string;
}
