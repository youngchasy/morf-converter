use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
    process::Command,
    sync::{OnceLock, RwLock},
};

use crate::model::{EngineInfo, EngineInstallPlan};
use crate::{engine_bundle, process::background_command};

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

fn runtime_directories(root: &Path) -> Vec<PathBuf> {
    [
        root.to_path_buf(),
        root.join("bin"),
        root.join("Library").join("bin"),
        root.join("Library").join("usr").join("bin"),
        root.join("Scripts"),
    ]
    .into_iter()
    .filter(|path| path.is_dir())
    .collect()
}

pub fn command(executable: &Path) -> Command {
    let _ = engine_bundle::ensure();
    let runtime = engine_bundle::runtime();
    #[cfg(target_os = "windows")]
    let mut command = if is_perl_batch_launcher(executable, true) {
        let perl = runtime
            .as_ref()
            .map(|runtime| {
                runtime
                    .environment
                    .join("Library")
                    .join("bin")
                    .join("perl.exe")
            })
            .filter(|path| path.is_file())
            .unwrap_or_else(|| PathBuf::from("perl.exe"));
        let mut command = background_command(perl);
        command.args(["-x", "-S"]).arg(executable);
        command
    } else {
        background_command(executable)
    };
    #[cfg(not(target_os = "windows"))]
    let mut command = background_command(executable);
    if let Some(runtime) = runtime {
        let mut path_entries = runtime_directories(&runtime.environment);
        if let Some(current) = env::var_os("PATH") {
            path_entries.extend(env::split_paths(&current));
        }
        if let Ok(path) = env::join_paths(path_entries) {
            command.env("PATH", path);
        }
        command.env("CONDA_PREFIX", &runtime.environment);
        for directory in [
            runtime
                .environment
                .join("etc")
                .join("conda")
                .join("env_vars.d"),
            runtime
                .environment
                .join("Library")
                .join("etc")
                .join("conda")
                .join("env_vars.d"),
        ] {
            let Ok(entries) = std::fs::read_dir(directory) else {
                continue;
            };
            for entry in entries.flatten() {
                let Ok(contents) = std::fs::read_to_string(entry.path()) else {
                    continue;
                };
                let Ok(values) = serde_json::from_str::<HashMap<String, String>>(&contents) else {
                    continue;
                };
                command.envs(values);
            }
        }
        for tessdata in [
            runtime.environment.join("share").join("tessdata"),
            runtime
                .environment
                .join("Library")
                .join("share")
                .join("tessdata"),
        ] {
            if tessdata.is_dir() {
                command.env("TESSDATA_PREFIX", tessdata);
                break;
            }
        }
    }
    command
}

fn executable_names(command: &str, windows: bool) -> Vec<String> {
    if !windows || Path::new(command).extension().is_some() {
        return vec![command.to_string()];
    }
    ["exe", "com", "bat", "cmd"]
        .into_iter()
        .map(|extension| format!("{command}.{extension}"))
        .chain(std::iter::once(command.to_string()))
        .collect()
}

#[cfg(any(target_os = "windows", test))]
fn is_perl_batch_launcher(executable: &Path, windows: bool) -> bool {
    windows
        && executable
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("exiftool.bat"))
}

fn bundled_command_candidates(command: &str) -> Vec<PathBuf> {
    let _ = engine_bundle::ensure();
    let Some(runtime) = engine_bundle::runtime() else {
        return Vec::new();
    };
    let names = executable_names(command, cfg!(target_os = "windows"));
    let directories = runtime_directories(&runtime.environment);
    let mut candidates = Vec::new();
    for name in &names {
        for directory in &directories {
            candidates.push(directory.join(name.as_str()));
        }
    }
    candidates
}

fn engine_candidates(id: &str, executable: &str, additional: &[&str]) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if id == "libreoffice" {
        let _ = engine_bundle::ensure();
        if let Some(runtime) = engine_bundle::runtime() {
            candidates.push(runtime.libreoffice_executable);
        }
    } else {
        candidates.extend(bundled_command_candidates(executable));
    }
    candidates.extend(platform_candidates(executable, additional));
    candidates
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
            candidates: engine_candidates(
                "ffmpeg",
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
            candidates: engine_candidates(
                "libreoffice",
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
            candidates: engine_candidates(
                "pandoc",
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
            candidates: engine_candidates(
                "qpdf",
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
            candidates: engine_candidates(
                "poppler",
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
            candidates: engine_candidates(
                "tesseract",
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
            candidates: engine_candidates(
                "exiftool",
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
                let mut candidates = engine_candidates(
                    "7zip",
                    "7z",
                    &[
                        "/opt/homebrew/bin/7zz",
                        "/usr/local/bin/7zz",
                        r"C:\Program Files\7-Zip\7z.exe",
                    ],
                );
                candidates.extend(engine_candidates("7zip", "7zz", &[]));
                candidates
            },
            version_argument: "-h",
        },
    ]
}

fn platform_candidates(command: &str, additional: &[&str]) -> Vec<PathBuf> {
    let names = executable_names(command, cfg!(target_os = "windows"));
    let mut candidates = names
        .iter()
        .map(|name| PathBuf::from(name.as_str()))
        .collect::<Vec<_>>();
    candidates.extend(additional.iter().map(|value| PathBuf::from(*value)));

    if let Some(path) = env::var_os("PATH") {
        let directories = env::split_paths(&path).collect::<Vec<_>>();
        for name in &names {
            for directory in &directories {
                candidates.push(directory.join(name.as_str()));
            }
        }
    }
    candidates
}

fn probe(executable: &Path, argument: &str) -> Option<String> {
    let output = command(executable).arg(argument).output().ok()?;
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
    bundled_command_candidates(command)
        .into_iter()
        .chain(platform_candidates(command, &[]))
        .find(|candidate| self::command(candidate).arg("-h").output().is_ok())
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
        if self::command(&sibling).arg("-h").output().is_ok() {
            return Some(sibling);
        }
    }
    find_command(command)
}

pub fn detect() -> Result<Vec<EngineInfo>, String> {
    engine_bundle::ensure()?;
    let mut result = vec![EngineInfo {
        id: "native".to_string(),
        name: "Morf Core".to_string(),
        installed: true,
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        path: None,
        description: "Изображения, PDF из изображений и данные".to_string(),
        formats: [
            "PNG", "JPEG", "WebP", "BMP", "TIFF", "JSON", "YAML", "TOML", "CSV",
        ]
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
            formats: definition
                .formats
                .iter()
                .map(|item| item.to_string())
                .collect(),
        });
    }
    Ok(result)
}

#[cfg(test)]
mod command_candidate_tests {
    use super::{executable_names, is_perl_batch_launcher};
    use std::path::Path;

    #[test]
    fn windows_candidates_prefer_native_and_batch_launchers() {
        assert_eq!(
            executable_names("exiftool", true),
            vec![
                "exiftool.exe".to_string(),
                "exiftool.com".to_string(),
                "exiftool.bat".to_string(),
                "exiftool.cmd".to_string(),
                "exiftool".to_string()
            ]
        );
        assert!(is_perl_batch_launcher(
            Path::new("C:/env/bin/exiftool.bat"),
            true
        ));
        assert!(!is_perl_batch_launcher(Path::new("exiftool"), true));
    }
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
