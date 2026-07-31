import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  ArchiveCreateRequest,
  ArchiveExtractRequest,
  BatchResult,
  CombineRequest,
  ConversionRequest,
  EngineInstallPlan,
  EngineInfo,
  JobSnapshot,
  OcrRequest,
  SplitRequest,
  WorkFile
} from "../types";
import { basename, mockFile } from "./files";

export const isDesktop = (): boolean => Boolean(window.__TAURI_INTERNALS__);

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export async function pickFiles(multiple = true): Promise<string[]> {
  if (isDesktop()) {
    const selection = await open({
      multiple,
      directory: false,
      title: multiple ? "Выберите файлы" : "Выберите файл"
    });
    if (!selection) return [];
    return Array.isArray(selection) ? selection : [selection];
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.onchange = () => {
      resolve(Array.from(input.files ?? []).map((file) => file.name));
    };
    input.click();
  });
}

export async function pickFolder(): Promise<string | null> {
  if (!isDesktop()) return "Экспорт/Morf";
  const selection = await open({
    directory: true,
    multiple: false,
    title: "Куда сохранить результат"
  });
  return typeof selection === "string" ? selection : null;
}

export async function pickOutputPdf(defaultName = "morf-document.pdf"): Promise<string | null> {
  if (!isDesktop()) return `Экспорт/${defaultName}`;
  return save({
    title: "Сохранить PDF",
    defaultPath: defaultName,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
}

export async function pickOutputFile(
  defaultName: string,
  label: string,
  extensions: string[]
): Promise<string | null> {
  if (!isDesktop()) return `Экспорт/${defaultName}`;
  return save({
    title: `Сохранить ${label}`,
    defaultPath: defaultName,
    filters: [{ name: label, extensions }]
  });
}

export async function inspectPaths(paths: string[]): Promise<WorkFile[]> {
  if (!isDesktop()) return paths.map((path) => mockFile(path));
  return invoke<WorkFile[]>("inspect_paths", { paths });
}

export async function detectEngines(): Promise<EngineInfo[]> {
  if (!isDesktop()) {
    return [
      {
        id: "native",
        name: "Morf Core",
        installed: true,
        version: "0.1",
        description: "Изображения, PDF из изображений и данные",
        formats: ["PNG", "JPEG", "WebP", "JSON", "YAML", "TOML", "CSV"]
      },
      {
        id: "ffmpeg",
        name: "FFmpeg",
        installed: false,
        description: "Видео и аудио",
        formats: ["MP4", "WebM", "MP3", "WAV", "FLAC"]
      },
      {
        id: "libreoffice",
        name: "LibreOffice",
        installed: false,
        description: "Офисные документы",
        formats: ["DOCX", "XLSX", "PPTX", "ODT", "PDF"]
      },
      {
        id: "pandoc",
        name: "Pandoc",
        installed: false,
        description: "Разметка и электронные книги",
        formats: ["Markdown", "HTML", "EPUB"]
      },
      {
        id: "qpdf",
        name: "qpdf",
        installed: false,
        description: "Разделение и объединение PDF",
        formats: ["PDF"]
      },
      {
        id: "poppler",
        name: "Poppler",
        installed: false,
        description: "PDF в изображения и текст",
        formats: ["PDF", "PNG", "JPEG", "TXT"]
      },
      {
        id: "tesseract",
        name: "Tesseract OCR",
        installed: false,
        description: "Распознавание текста",
        formats: ["PNG", "JPEG", "PDF", "TXT"]
      },
      {
        id: "exiftool",
        name: "ExifTool",
        installed: false,
        description: "Просмотр и удаление метаданных",
        formats: ["EXIF", "XMP", "IPTC"]
      },
      {
        id: "7zip",
        name: "7-Zip",
        installed: false,
        description: "Архивы 7Z, RAR, TAR и другие",
        formats: ["7Z", "RAR", "ZIP", "TAR"]
      }
    ];
  }
  return invoke<EngineInfo[]>("detect_engines");
}

export async function convertFiles(request: ConversionRequest): Promise<BatchResult> {
  if (isDesktop()) return invoke<BatchResult>("convert_files", { request });
  await wait(900);
  return {
    outputDir: request.outputDir,
    items: request.inputs.map((input) => ({
      input,
      output: `${request.outputDir}/${basename(input).replace(/\.[^.]+$/, "")}.${request.targetFormat}`,
      success: true
    }))
  };
}

export async function combineFiles(request: CombineRequest): Promise<BatchResult> {
  if (isDesktop()) return invoke<BatchResult>("combine_files", { request });
  await wait(900);
  return {
    outputDir: request.outputPath.replace(/[\\/][^\\/]+$/, ""),
    items: [
      {
        input: request.items.map((item) => item.path).join(", "),
        output: request.outputPath,
        success: true
      }
    ]
  };
}

export async function splitFile(request: SplitRequest): Promise<BatchResult> {
  if (isDesktop()) return invoke<BatchResult>("split_file", { request });
  await wait(900);
  return {
    outputDir: request.outputDir,
    items: Array.from({ length: Math.max(2, request.rows * request.columns) }, (_, index) => ({
      input: request.input,
      output: `${request.outputDir}/part-${String(index + 1).padStart(2, "0")}.${request.targetFormat}`,
      success: true
    }))
  };
}

export async function revealPath(path: string): Promise<void> {
  if (!isDesktop()) return;
  await invoke("reveal_path", { path });
}

const mockJobs = new Map<string, JobSnapshot>();

function runMockJob(id: string, request: ConversionRequest) {
  const tick = () => {
    const job = mockJobs.get(id);
    if (!job || ["cancelled", "completed", "failed"].includes(job.status)) return;
    if (job.status === "paused" || job.status === "cancelling") {
      if (job.status === "cancelling") {
        mockJobs.set(id, { ...job, status: "cancelled", message: "Задача отменена" });
        return;
      }
      window.setTimeout(tick, 250);
      return;
    }
    const completed = Math.min(job.total, job.completed + 1);
    const done = completed === job.total;
    mockJobs.set(id, {
      ...job,
      status: done ? "completed" : "running",
      completed,
      progress: Math.round((completed / job.total) * 100),
      message: done ? "Все файлы обработаны" : `Готово ${completed} из ${job.total}`,
      result: done
        ? {
            outputDir: request.outputDir,
            items: request.inputs.map((input) => ({
              input,
              output: `${request.outputDir}/${basename(input).replace(/\.[^.]+$/, "")}.${request.targetFormat}`,
              success: true
            }))
          }
        : undefined
    });
    if (!done) window.setTimeout(tick, 450);
  };
  window.setTimeout(tick, 350);
}

export async function startConversionJob(request: ConversionRequest): Promise<string> {
  if (isDesktop()) return invoke<string>("start_conversion_job", { request });
  const id = crypto.randomUUID();
  mockJobs.set(id, {
    id,
    operation: "convert",
    status: "running",
    progress: 0,
    completed: 0,
    total: request.inputs.length,
    message: "Обработка началась",
    createdAt: Date.now()
  });
  runMockJob(id, request);
  return id;
}

export async function getJob(id: string): Promise<JobSnapshot> {
  if (isDesktop()) return invoke<JobSnapshot>("get_job", { id });
  const job = mockJobs.get(id);
  if (!job) throw new Error("Задача не найдена");
  return { ...job };
}

export async function listJobs(): Promise<JobSnapshot[]> {
  if (isDesktop()) return invoke<JobSnapshot[]>("list_jobs");
  return [...mockJobs.values()].sort((left, right) => right.createdAt - left.createdAt);
}

export async function pauseJob(id: string): Promise<JobSnapshot> {
  if (isDesktop()) return invoke<JobSnapshot>("pause_job", { id });
  const job = await getJob(id);
  const next = { ...job, status: "paused" as const, message: "Задача приостановлена" };
  mockJobs.set(id, next);
  return next;
}

export async function resumeJob(id: string): Promise<JobSnapshot> {
  if (isDesktop()) return invoke<JobSnapshot>("resume_job", { id });
  const job = await getJob(id);
  const next = { ...job, status: "running" as const, message: "Обработка продолжена" };
  mockJobs.set(id, next);
  return next;
}

export async function cancelJob(id: string): Promise<JobSnapshot> {
  if (isDesktop()) return invoke<JobSnapshot>("cancel_job", { id });
  const job = await getJob(id);
  const next = { ...job, status: "cancelling" as const, message: "Отмена…" };
  mockJobs.set(id, next);
  return next;
}

const defaultSettings: AppSettings = {
  maxParallelJobs: 2,
  enginePaths: {},
  hardwareEncoder: "software"
};

export async function getSettings(): Promise<AppSettings> {
  if (isDesktop()) return invoke<AppSettings>("get_settings");
  try {
    const value = localStorage.getItem("morf.settings.v1");
    return value ? { ...defaultSettings, ...JSON.parse(value) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(value: AppSettings): Promise<AppSettings> {
  if (isDesktop()) return invoke<AppSettings>("save_settings", { value });
  localStorage.setItem("morf.settings.v1", JSON.stringify(value));
  return value;
}

export async function getEngineInstallPlans(): Promise<EngineInstallPlan[]> {
  if (isDesktop()) return invoke<EngineInstallPlan[]>("engine_install_plans");
  return [];
}

export async function fileThumbnail(
  path: string,
  page = 1,
  maxSize = 420
): Promise<string | null> {
  if (!isDesktop()) return null;
  return invoke<string>("file_thumbnail", { path, page, maxSize });
}

export async function runOcr(request: OcrRequest): Promise<string> {
  if (isDesktop()) return invoke<string>("run_ocr", { request });
  await wait(700);
  return `${request.outputDir}/preview-ocr.${request.outputFormat}`;
}

export async function createArchive(request: ArchiveCreateRequest): Promise<string> {
  if (isDesktop()) return invoke<string>("create_archive", { request });
  await wait(500);
  return request.outputPath;
}

export async function extractArchive(request: ArchiveExtractRequest): Promise<string[]> {
  if (isDesktop()) return invoke<string[]>("extract_archive", { request });
  await wait(500);
  return [`${request.outputDir}/preview-file.txt`];
}

export async function readMetadata(path: string): Promise<unknown> {
  if (isDesktop()) return invoke<unknown>("read_metadata", { path });
  return [{ SourceFile: path, FileType: "PREVIEW", ImageWidth: 1920, ImageHeight: 1080 }];
}

export async function stripMetadataCopy(path: string, outputDir: string): Promise<string> {
  if (isDesktop()) return invoke<string>("strip_metadata_copy", { path, outputDir });
  await wait(400);
  return `${outputDir}/${basename(path)}-clean`;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isDesktop()) {
    await invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function getInitialFiles(): Promise<string[]> {
  if (!isDesktop()) return [];
  return invoke<string[]>("initial_files");
}

export async function listenOpenFiles(
  handler: (paths: string[]) => void
): Promise<() => void> {
  if (!isDesktop()) return () => undefined;
  return listen<string[]>("open-files", (event) => handler(event.payload));
}

export async function listenNativeDrops(
  handler: (paths: string[]) => void
): Promise<() => void> {
  if (!isDesktop()) return () => undefined;
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "drop") handler(event.payload.paths);
  });
}
