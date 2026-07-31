import type { FileKind, FormatItem } from "../types";

export const FORMAT_GROUPS: Array<{
  id: FileKind;
  label: string;
  formats: FormatItem[];
}> = [
  {
    id: "image",
    label: "Изображения",
    formats: [
      ["png", "PNG", "native"],
      ["jpg", "JPEG", "native"],
      ["webp", "WebP", "native"],
      ["bmp", "BMP", "native"],
      ["tiff", "TIFF", "native"],
      ["gif", "GIF", "native"],
      ["ico", "ICO", "native"],
      ["avif", "AVIF", "ffmpeg"],
      ["heic", "HEIC", "ffmpeg"],
      ["heif", "HEIF", "ffmpeg"],
      ["svg", "SVG", "ffmpeg"]
    ].map(([extension, label, engine]) => ({
      extension,
      label,
      engine,
      kind: "image"
    })) as FormatItem[]
  },
  {
    id: "video",
    label: "Видео",
    formats: [
      ["mp4", "MP4", "ffmpeg"],
      ["mkv", "Matroska", "ffmpeg"],
      ["mov", "QuickTime", "ffmpeg"],
      ["webm", "WebM", "ffmpeg"],
      ["avi", "AVI", "ffmpeg"],
      ["mpeg", "MPEG", "ffmpeg"],
      ["mpg", "MPEG Program Stream", "ffmpeg"],
      ["m4v", "M4V", "ffmpeg"],
      ["m2ts", "MPEG Transport Stream", "ffmpeg"],
      ["mts", "AVCHD", "ffmpeg"],
      ["flv", "Flash Video", "ffmpeg"],
      ["3gp", "3GPP", "ffmpeg"],
      ["ogv", "Ogg Video", "ffmpeg"]
    ].map(([extension, label, engine]) => ({
      extension,
      label,
      engine,
      kind: "video"
    })) as FormatItem[]
  },
  {
    id: "audio",
    label: "Аудио",
    formats: [
      ["mp3", "MP3", "ffmpeg"],
      ["wav", "WAV", "ffmpeg"],
      ["flac", "FLAC", "ffmpeg"],
      ["m4a", "M4A", "ffmpeg"],
      ["aac", "AAC", "ffmpeg"],
      ["ogg", "Ogg Vorbis", "ffmpeg"],
      ["opus", "Opus", "ffmpeg"],
      ["wma", "WMA", "ffmpeg"],
      ["aiff", "AIFF", "ffmpeg"],
      ["ac3", "Dolby AC-3", "ffmpeg"]
    ].map(([extension, label, engine]) => ({
      extension,
      label,
      engine,
      kind: "audio"
    })) as FormatItem[]
  },
  {
    id: "document",
    label: "Документы и таблицы",
    formats: [
      ["pdf", "PDF", "libreoffice"],
      ["doc", "Word DOC", "libreoffice"],
      ["docx", "Word DOCX", "libreoffice"],
      ["odt", "OpenDocument Text", "libreoffice"],
      ["rtf", "Rich Text", "libreoffice"],
      ["html", "HTML", "pandoc"],
      ["md", "Markdown", "pandoc"],
      ["epub", "EPUB", "pandoc"],
      ["xlsx", "Excel XLSX", "libreoffice"],
      ["xls", "Excel XLS", "libreoffice"],
      ["ods", "OpenDocument Sheet", "libreoffice"],
      ["csv", "CSV", "native"],
      ["pptx", "PowerPoint PPTX", "libreoffice"],
      ["ppt", "PowerPoint PPT", "libreoffice"],
      ["odp", "OpenDocument Slides", "libreoffice"],
      ["txt", "Обычный текст", "native"]
    ].map(([extension, label, engine]) => ({
      extension,
      label,
      engine,
      kind: extension === "pdf" ? "pdf" : "document"
    })) as FormatItem[]
  },
  {
    id: "data",
    label: "Данные и разработка",
    formats: [
      ["json", "JSON", "native"],
      ["yaml", "YAML", "native"],
      ["toml", "TOML", "native"],
      ["csv", "CSV", "native"],
      ["txt", "Plain text", "native"],
      ["xml", "XML", "pandoc"]
    ].map(([extension, label, engine]) => ({
      extension,
      label,
      engine,
      kind: "data"
    })) as FormatItem[]
  },
  {
    id: "archive",
    label: "Архивы",
    formats: [
      ["zip", "ZIP", "7zip"],
      ["7z", "7-Zip", "7zip"],
      ["tar", "TAR", "7zip"],
      ["gz", "GZip", "7zip"]
    ].map(([extension, label, engine]) => ({
      extension,
      label,
      engine,
      kind: "archive"
    })) as FormatItem[]
  }
];

export const ALL_FORMATS = FORMAT_GROUPS.flatMap((group) => group.formats);

const extensionKinds: Record<string, FileKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  bmp: "image",
  tiff: "image",
  tif: "image",
  gif: "image",
  ico: "image",
  avif: "image",
  heic: "image",
  heif: "image",
  svg: "image",
  mp4: "video",
  mkv: "video",
  mov: "video",
  webm: "video",
  avi: "video",
  mpeg: "video",
  mpg: "video",
  m4v: "video",
  m2ts: "video",
  mts: "video",
  flv: "video",
  "3gp": "video",
  ogv: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  m4a: "audio",
  aac: "audio",
  ogg: "audio",
  opus: "audio",
  wma: "audio",
  aiff: "audio",
  ac3: "audio",
  pdf: "pdf",
  doc: "document",
  docx: "document",
  odt: "document",
  rtf: "document",
  xls: "document",
  xlsx: "document",
  ods: "document",
  csv: "data",
  ppt: "document",
  pptx: "document",
  odp: "document",
  epub: "document",
  md: "data",
  markdown: "data",
  html: "data",
  htm: "data",
  json: "data",
  yaml: "data",
  yml: "data",
  toml: "data",
  xml: "data",
  txt: "data",
  js: "data",
  jsx: "data",
  ts: "data",
  tsx: "data",
  py: "data",
  rs: "data",
  go: "data",
  java: "data",
  c: "data",
  cpp: "data",
  h: "data",
  css: "data",
  scss: "data",
  sql: "data",
  sh: "data",
  srt: "data",
  vtt: "data",
  zip: "archive",
  tar: "archive",
  gz: "archive",
  "7z": "archive"
};

export function kindFromExtension(extension: string): FileKind {
  return extensionKinds[extension.toLowerCase()] ?? "unknown";
}

function uniqueFormats(formats: FormatItem[]): FormatItem[] {
  const byExtension = new Map<string, FormatItem>();
  for (const format of formats) {
    const current = byExtension.get(format.extension);
    if (!current || (current.engine !== "native" && format.engine === "native")) {
      byExtension.set(format.extension, format);
    }
  }
  return [...byExtension.values()];
}

export function targetsForKind(kind?: FileKind, sourceExtension = ""): FormatItem[] {
  if (!kind || kind === "unknown") return uniqueFormats(ALL_FORMATS);
  const source = sourceExtension.toLowerCase();

  const extensions: Record<Exclude<FileKind, "unknown" | "archive">, Set<string>> = {
    image: new Set([
      "png",
      "jpg",
      "webp",
      "bmp",
      "tiff",
      "gif",
      "ico",
      "avif",
      "heic",
      "heif",
      "pdf"
    ]),
    video: new Set([
      "mp4",
      "mkv",
      "mov",
      "webm",
      "avi",
      "mpeg",
      "mpg",
      "m4v",
      "m2ts",
      "mts",
      "flv",
      "3gp",
      "ogv",
      "mp3",
      "wav",
      "flac",
      "m4a",
      "aac",
      "ogg",
      "opus",
      "wma",
      "aiff",
      "ac3",
      "png",
      "jpg",
      "webp",
      "avif",
      "gif"
    ]),
    audio: new Set([
      "mp3",
      "wav",
      "flac",
      "m4a",
      "aac",
      "ogg",
      "opus",
      "wma",
      "aiff",
      "ac3"
    ]),
    pdf: new Set(["pdf", "png", "jpg", "txt"]),
    document: new Set([
      "pdf",
      "docx",
      "odt",
      "rtf",
      "html",
      "md",
      "epub",
      "xlsx",
      "ods",
      "csv",
      "pptx",
      "odp",
      "txt"
    ]),
    data: new Set(["json", "yaml", "toml", "csv", "txt", "md"])
  };

  if (kind === "archive") return [];
  if (kind === "document") {
    if (["xls", "xlsx", "ods"].includes(source)) {
      extensions.document = new Set(["pdf", "xls", "xlsx", "ods", "csv", "html"]);
    } else if (["ppt", "pptx", "odp"].includes(source)) {
      extensions.document = new Set(["pdf", "ppt", "pptx", "odp"]);
    } else if (source === "epub") {
      extensions.document = new Set(["pdf", "docx", "odt", "html", "md", "epub", "txt"]);
    } else {
      extensions.document = new Set([
        "pdf",
        "doc",
        "docx",
        "odt",
        "rtf",
        "html",
        "md",
        "epub",
        "txt"
      ]);
    }
  } else if (kind === "data") {
    if (["md", "markdown", "html", "htm"].includes(source)) {
      extensions.data = new Set(["txt", "md", "html", "docx", "odt", "epub", "pdf"]);
    } else if (source === "xml") {
      extensions.data = new Set(["txt", "md", "json", "yaml", "toml"]);
    } else if (
      source &&
      !["json", "yaml", "yml", "toml", "csv", "xml"].includes(source)
    ) {
      extensions.data = new Set(["txt", "md", "json", "yaml", "toml"]);
    }
  }
  return uniqueFormats(
    ALL_FORMATS.filter((format) => extensions[kind].has(format.extension))
  );
}

export function requiredEngines(
  sourceKind: FileKind | undefined,
  target: FormatItem | undefined,
  sourceExtension = ""
): string[] {
  if (!target) return ["native"];
  const source = sourceExtension.toLowerCase();
  if (sourceKind === "pdf" && target.kind === "image") return ["poppler"];
  if (sourceKind === "pdf" && target.extension === "txt") return ["poppler"];
  if (sourceKind === "pdf" && target.extension === "pdf") return ["native"];
  if (sourceKind === "video" || sourceKind === "audio") return ["ffmpeg"];
  if (
    sourceKind === "image" &&
    ["avif", "heic", "heif", "svg"].includes(source)
  ) {
    return ["ffmpeg"];
  }
  if (sourceKind === "document") {
    if (["xls", "xlsx", "ods", "ppt", "pptx", "odp"].includes(source)) {
      return ["libreoffice"];
    }
    if (
      ["doc", "rtf"].includes(source) &&
      ["md", "html", "epub"].includes(target.extension)
    ) {
      return ["libreoffice", "pandoc"];
    }
    if (
      ["md", "markdown", "html", "htm"].includes(source) &&
      target.extension === "pdf"
    ) {
      return ["pandoc", "libreoffice"];
    }
    if (source === "epub") {
      return target.extension === "pdf"
        ? ["pandoc", "libreoffice"]
        : ["pandoc"];
    }
    return [
      ["md", "html", "epub"].includes(target.extension) ? "pandoc" : "libreoffice"
    ];
  }
  if (sourceKind === "image" && target.extension === "pdf") return ["native"];
  if (
    sourceKind === "data" &&
    ["md", "markdown"].includes(source) &&
    ["txt", "md"].includes(target.extension)
  ) {
    return ["native"];
  }
  if (sourceKind === "data" && ["md", "markdown", "html", "htm"].includes(source)) {
    return target.extension === "pdf"
      ? ["pandoc", "libreoffice"]
      : ["pandoc"];
  }
  if (
    sourceKind === "data" &&
    ["json", "yaml", "toml", "csv", "txt", "md"].includes(target.extension)
  ) {
    return ["native"];
  }
  return [target.engine];
}

export function requiredEngine(
  sourceKind: FileKind | undefined,
  target: FormatItem | undefined,
  sourceExtension = ""
): string {
  return requiredEngines(sourceKind, target, sourceExtension)[0];
}
