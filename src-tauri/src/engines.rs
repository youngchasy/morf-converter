use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
    process::Command,
    sync::{OnceLock, RwLock},
};

use crate::model::{EngineInfo, EngineInstallPlan};

static CUSTOM_PATHS: OnceLock<RwLock<HashMap<String, PathBuf>>> = OnceLock::new();

fn custom_paths() -> &'static RwLock<HashMap<String, PathBuf>> {
    CUSTOM_PATHS.get_or_init(|| RwLock::new(HashMap::new()))
}

pub fn set_custom_paths(paths: &HashMap<String, String>) {
    let mut next = HashMap::new();
    for (id, value) in paths {
        if !value.trim().is_empty() {
            next.insert(id.clone(), PathBuf::from(value));
        }
    }
    if let Ok(mut current) = custom_paths().write() {
        *current = next;
    }
}

fn custom_path(id: &str) -> Option<PathBuf> {
    custom_paths().read().ok()?.get(id).cloned()
}

struct EngineDefinition {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    formats: &'static [&'static str],
    candidates: Vec<PathBuf>,
    version_argument: &'static str,
}

fn definitions() -> Vec<EngineDefinition> {
    vec![
        EngineDefinition {
            id: "ffmpeg",
            name: "FFmpeg",
            description: "Видео и аудио",
            formats: &["MP4", "WebM", "MOV", "MP3", "WAV", "FLAC", "Opus"],
            candidates: platform_candidates(
                "ffmpeg",
                &[
                    "/opt/homebrew/bin/ffmpeg",
                    "/usr/local/bin/ffmpeg",
                    r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
                ],
            ),
            version_argument: "-version",
        },
        EngineDefinition {
            id: "libreoffice",
            name: "LibreOffice",
            description: "Офисные документы",
            formats: &["DOCX", "XLSX", "PPTX", "ODT", "ODS", "PDF"],
            candidates: platform_candidates(
                "soffice",
                &[
                    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
                    "/usr/lib/libreoffice/program/soffice",
                    r"C:\Program Files\LibreOffice\program\soffice.exe",
                ],
            ),
            version_argument: "--version",
        },
        EngineDefinition {
            id: "pandoc",
            name: "Pandoc",
            description: "Разметка и электронные книги",
            formats: &["Markdown", "HTML", "EPUB", "DOCX"],
            candidates: platform_candidates(
                "pandoc",
                &[
                    "/opt/homebrew/bin/pandoc",
                    "/usr/local/bin/pandoc",
                    r"C:\Program Files\Pandoc\pandoc.exe",
                ],
            ),
            version_argument: "--version",
        },
        EngineDefinition {
            id: "qpdf",
            name: "qpdf",
            description: "Разделение и объединение PDF без потерь",
            formats: &["PDF"],
            candidates: platform_candidates(
                "qpdf",
                &[
                    "/opt/homebrew/bin/qpdf",
                    "/usr/local/bin/qpdf",
                    r"C:\Program Files\qpdf\bin\qpdf.exe",
                ],
            ),
            version_argument: "--version",
        },
        EngineDefinition {
            id: "poppler",
            name: "Poppler",
            description: "PDF в изображения и текст",
            formats: &["PDF", "PNG", "JPEG", "TXT"],
            candidates: platform_candidates(
                "pdftoppm",
                &[
                    "/opt/homebrew/bin/pdftoppm",
                    "/usr/local/bin/pdftoppm",
                    r"C:\Program Files\poppler\Library\bin\pdftoppm.exe",
                ],
            ),
            version_argument: "-v",
        },
        EngineDefinition {
            id: "tesseract",
            name: "Tesseract OCR",
            description: "Распознавание текста в изображениях и PDF",
            formats: &["PNG", "JPEG", "TIFF", "PDF", "TXT"],
            candidates: platform_candidates(
                "tesseract",
                &[
                    "/opt/homebrew/bin/tesseract",
                    "/usr/local/bin/tesseract",
                    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                ],
            ),
            version_argument: "--version",
        },
        EngineDefinition {
            id: "exiftool",
            name: "ExifTool",
            description: "Просмотр и удаление метаданных",
            formats: &["EXIF", "XMP", "IPTC", "PDF", "Media"],
            candidates: platform_candidates(
                "exiftool",
                &[
                    "/opt/homebrew/bin/exiftool",
                    "/usr/local/bin/exiftool",
                    r"C:\Program Files\ExifTool\exiftool.exe",
                ],
            ),
            version_argument: "-ver",
        },
        EngineDefinition {
            id: "7zip",
            name: "7-Zip",
            description: "Архивы 7Z, RAR, TAR и другие",
            formats: &["7Z", "RAR", "ZIP", "TAR", "GZ"],
            candidates: {
                let mut candidates = platform_candidates(
                    "7z",
                    &[
                        "/opt/homebrew/bin/7zz",
                        "/usr/local/bin/7zz",
                        r"C:\Program Files\7-Zip\7z.exe",
                    ],
                );
                candidates.extend(platform_candidates("7zz", &[]));
                candidates
            },
            version_argument: "-h",
        },
    ]
}

fn platform_candidates(command: &str, additional: &[&str]) -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from(command)];
    #[cfg(target_os = "windows")]
    if !command.ends_with(".exe") {
        candidates.push(PathBuf::from(format!("{command}.exe")));
    }
    candidates.extend(additional.iter().map(|value| PathBuf::from(*value)));

    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            candidates.push(directory.join(command));
            #[cfg(target_os = "windows")]
            candidates.push(directory.join(format!("{command}.exe")));
        }
    }
    candidates
}

fn probe(executable: &Path, argument: &str) -> Option<String> {
    let output = Command::new(executable).arg(argument).output().ok()?;
    if !output.status.success() && output.stdout.is_empty() && output.stderr.is_empty() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| Some("обнаружен".to_string()))
}

pub fn find_engine(id: &str) -> Option<PathBuf> {
    let definition = definitions().into_iter().find(|engine| engine.id == id)?;
    if let Some(candidate) = custom_path(id) {
        if probe(&candidate, definition.version_argument).is_some() {
            return Some(candidate);
        }
    }
    definition
        .candidates
        .into_iter()
        .find(|candidate| probe(candidate, definition.version_argument).is_some())
}

pub fn find_command(command: &str) -> Option<PathBuf> {
    platform_candidates(command, &[])
        .into_iter()
        .find(|candidate| Command::new(candidate).arg("-h").output().is_ok())
}

pub fn find_related_command(engine_id: &str, command: &str) -> Option<PathBuf> {
    if let Some(engine) = find_engine(engine_id) {
        let file_name = if engine
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
        {
            format!("{command}.exe")
        } else {
            command.to_string()
        };
        let sibling = engine.with_file_name(file_name);
        if Command::new(&sibling).arg("-h").output().is_ok() {
            return Some(sibling);
        }
    }
    find_command(command)
}

pub fn detect() -> Vec<EngineInfo> {
    let mut result = vec![EngineInfo {
        id: "native".to_string(),
        name: "Morf Core".to_string(),
        installed: true,
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        path: None,
        description: "Изображения, PDF из изображений и данные".to_string(),
        formats: ["PNG", "JPEG", "WebP", "BMP", "TIFF", "JSON", "YAML", "TOML", "CSV"]
            .into_iter()
            .map(str::to_string)
            .collect(),
    }];

    for definition in definitions() {
        let detected = custom_path(definition.id)
            .into_iter()
            .chain(definition.candidates.iter().cloned())
            .find_map(|candidate| {
                probe(&candidate, definition.version_argument).map(|version| (candidate, version))
            });
        result.push(EngineInfo {
            id: definition.id.to_string(),
            name: definition.name.to_string(),
            installed: detected.is_some(),
            version: detected.as_ref().map(|(_, version)| version.clone()),
            path: detected.map(|(path, _)| path.to_string_lossy().to_string()),
            description: definition.description.to_string(),
            formats: definition.formats.iter().map(|item| item.to_string()).collect(),
        });
    }
    result
}

pub fn install_plans() -> Vec<EngineInstallPlan> {
    let command_for = |windows: &str, macos: &str, linux: &str| {
        if cfg!(target_os = "windows") {
            windows.to_string()
        } else if cfg!(target_os = "macos") {
            macos.to_string()
        } else {
            linux.to_string()
        }
    };
    let note = if cfg!(target_os = "linux") {
        "Команда рассчитана на Ubuntu/Debian. Для другого дистрибутива используйте его менеджер пакетов."
    } else {
        "Morf не запускает системную установку без вашего подтверждения: скопируйте команду в терминал."
    };

    [
        (
            "ffmpeg",
            "FFmpeg",
            "winget install --id Gyan.FFmpeg",
            "brew install ffmpeg",
            "sudo apt install ffmpeg",
            "https://ffmpeg.org/download.html",
        ),
        (
            "libreoffice",
            "LibreOffice",
            "winget install --id TheDocumentFoundation.LibreOffice",
            "brew install --cask libreoffice",
            "sudo apt install libreoffice",
            "https://www.libreoffice.org/download/download-libreoffice/",
        ),
        (
            "pandoc",
            "Pandoc",
            "winget install --id JohnMacFarlane.Pandoc",
            "brew install pandoc",
            "sudo apt install pandoc",
            "https://pandoc.org/installing.html",
        ),
        (
            "qpdf",
            "qpdf",
            "winget install --id QPDF.QPDF",
            "brew install qpdf",
            "sudo apt install qpdf",
            "https://qpdf.sourceforge.io/",
        ),
        (
            "poppler",
            "Poppler",
            "winget install --id oschwartz10612.Poppler",
            "brew install poppler",
            "sudo apt install poppler-utils",
            "https://poppler.freedesktop.org/",
        ),
        (
            "tesseract",
            "Tesseract OCR",
            "winget install --id UB-Mannheim.TesseractOCR",
            "brew install tesseract tesseract-lang",
            "sudo apt install tesseract-ocr tesseract-ocr-eng tesseract-ocr-rus",
            "https://tesseract-ocr.github.io/tessdoc/Installation.html",
        ),
        (
            "exiftool",
            "ExifTool",
            "winget install --id OliverBetz.ExifTool",
            "brew install exiftool",
            "sudo apt install libimage-exiftool-perl",
            "https://exiftool.org/install.html",
        ),
        (
            "7zip",
            "7-Zip",
            "winget install --id 7zip.7zip",
            "brew install sevenzip",
            "sudo apt install 7zip",
            "https://www.7-zip.org/download.html",
        ),
    ]
    .into_iter()
    .map(
        |(engine_id, title, windows, macos, linux, website)| EngineInstallPlan {
            engine_id: engine_id.to_string(),
            title: title.to_string(),
            command: command_for(windows, macos, linux),
            website: website.to_string(),
            note: note.to_string(),
        },
    )
    .collect()
}
