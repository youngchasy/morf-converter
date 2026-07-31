use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use lopdf::Document;
use tauri::{AppHandle, State};

use crate::{
    archive_ops, conversion, engines, external_ops, image_ops,
    jobs::JobManager,
    metadata_ops,
    model::{
        AppSettings, ArchiveCreateRequest, ArchiveExtractRequest, BatchResult, CombineRequest,
        ConversionRequest, EngineInstallPlan, FileKind, JobResult, JobSnapshot, OcrRequest,
        SplitRequest, WorkFile,
    },
    ocr_ops, pdf_ops, preview, settings,
    util::{ensure_directory, extension, stem},
    OpenedFiles,
};

fn kind_for_extension(value: &str) -> FileKind {
    match value {
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "tif" | "tiff" | "gif" | "ico"
        | "avif" | "heic" | "heif" | "svg" => FileKind::Image,
        "mp4" | "mkv" | "mov" | "webm" | "avi" | "mpeg" | "mpg" | "m4v" | "m2ts"
        | "mts" | "flv" | "3gp" | "ogv" => {
            FileKind::Video
        }
        "mp3" | "wav" | "flac" | "m4a" | "aac" | "ogg" | "opus" | "wma" | "aiff"
        | "ac3" => {
            FileKind::Audio
        }
        "pdf" => FileKind::Pdf,
        "doc" | "docx" | "odt" | "rtf" | "xls" | "xlsx" | "ods" | "ppt" | "pptx"
        | "odp" | "epub" => FileKind::Document,
        "json" | "yaml" | "yml" | "toml" | "csv" | "txt" | "md" | "markdown" | "html"
        | "htm" | "xml" | "js" | "jsx" | "ts" | "tsx" | "py" | "rs" | "go"
        | "java" | "c" | "cpp" | "h" | "css" | "scss" | "sql" | "sh" | "srt"
        | "vtt" => FileKind::Data,
        "zip" | "tar" | "gz" | "bz2" | "xz" | "7z" | "rar" => FileKind::Archive,
        _ => FileKind::Unknown,
    }
}

fn inspect_one(value: String) -> Result<WorkFile, String> {
    let path = PathBuf::from(&value);
    let metadata =
        fs::metadata(&path).map_err(|error| format!("Не удалось прочитать {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} не является файлом", path.display()));
    }
    let file_extension = extension(&path);
    let kind = kind_for_extension(&file_extension);
    let (detail, page_count) = match kind {
        FileKind::Image => match image::image_dimensions(&path) {
            Ok((width, height)) => (Some(format!("{width}×{height}")), None),
            Err(_) => (None, None),
        },
        FileKind::Pdf => match Document::load(&path) {
            Ok(document) => {
                let count = document.get_pages().len();
                (
                    Some(format!(
                        "{count} {}",
                        if count == 1 { "страница" } else { "страниц" }
                    )),
                    Some(count),
                )
            }
            Err(_) => (None, None),
        },
        _ => (None, None),
    };

    Ok(WorkFile {
        id: uuid::Uuid::new_v4().to_string(),
        path: value,
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file")
            .to_string(),
        extension: file_extension,
        size: metadata.len(),
        kind,
        detail,
        page_count,
        status: "ready".to_string(),
        error: None,
    })
}

#[tauri::command]
pub async fn inspect_paths(paths: Vec<String>) -> Result<Vec<WorkFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        paths.into_iter().map(inspect_one).collect::<Result<Vec<_>, _>>()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn detect_engines() -> Result<Vec<crate::model::EngineInfo>, String> {
    tauri::async_runtime::spawn_blocking(engines::detect)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn start_conversion_job(
    request: ConversionRequest,
    manager: State<'_, JobManager>,
) -> Result<String, String> {
    manager.start_conversion(request)
}

#[tauri::command]
pub fn get_job(id: String, manager: State<'_, JobManager>) -> Result<JobSnapshot, String> {
    manager.get(&id)
}

#[tauri::command]
pub fn list_jobs(manager: State<'_, JobManager>) -> Result<Vec<JobSnapshot>, String> {
    manager.list()
}

#[tauri::command]
pub fn pause_job(id: String, manager: State<'_, JobManager>) -> Result<JobSnapshot, String> {
    manager.pause(&id)
}

#[tauri::command]
pub fn resume_job(id: String, manager: State<'_, JobManager>) -> Result<JobSnapshot, String> {
    manager.resume(&id)
}

#[tauri::command]
pub fn cancel_job(id: String, manager: State<'_, JobManager>) -> Result<JobSnapshot, String> {
    manager.cancel(&id)
}

#[tauri::command]
pub fn get_settings(
    app: AppHandle,
    manager: State<'_, JobManager>,
) -> Result<AppSettings, String> {
    let settings = settings::load(&app)?;
    engines::set_custom_paths(&settings.engine_paths);
    manager.set_limit(settings.max_parallel_jobs);
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    manager: State<'_, JobManager>,
    mut value: AppSettings,
) -> Result<AppSettings, String> {
    value.max_parallel_jobs = value.max_parallel_jobs.clamp(1, 8);
    engines::set_custom_paths(&value.engine_paths);
    manager.set_limit(value.max_parallel_jobs);
    settings::save(&app, &value)?;
    Ok(value)
}

#[tauri::command]
pub fn engine_install_plans() -> Vec<EngineInstallPlan> {
    engines::install_plans()
}

#[tauri::command]
pub fn initial_files(opened: State<'_, OpenedFiles>) -> Vec<String> {
    opened
        .0
        .lock()
        .map(|mut paths| std::mem::take(&mut *paths))
        .unwrap_or_default()
}

#[tauri::command]
pub async fn file_thumbnail(
    path: String,
    page: usize,
    max_size: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || preview::thumbnail(&path, page, max_size))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn run_ocr(request: OcrRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ocr_ops::run(request).map(|path| path.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn create_archive(request: ArchiveCreateRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        archive_ops::create(request).map(|path| path.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn extract_archive(request: ArchiveExtractRequest) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        archive_ops::extract(request).map(|paths| {
            paths
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect()
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn read_metadata(path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || metadata_ops::read(&path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn strip_metadata_copy(
    path: String,
    output_dir: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        metadata_ops::strip_copy(&path, &output_dir)
            .map(|output| output.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn convert_files(request: ConversionRequest) -> Result<BatchResult, String> {
    tauri::async_runtime::spawn_blocking(move || conversion::run(request))
        .await
        .map_err(|error| error.to_string())?
}

fn combine_sync(request: CombineRequest) -> Result<BatchResult, String> {
    if request.items.is_empty() {
        return Err("Нет элементов для объединения".to_string());
    }
    let output = PathBuf::from(&request.output_path);
    if extension(&output) != "pdf" {
        return Err("Результат объединения должен иметь расширение .pdf".to_string());
    }
    if request
        .items
        .iter()
        .any(|item| Path::new(&item.path) == output.as_path())
    {
        return Err("Результат не может перезаписывать исходник".to_string());
    }
    if let Some(parent) = output.parent() {
        ensure_directory(parent)?;
    }
    if output.exists() {
        return Err("Файл результата уже существует. Выберите другое имя.".to_string());
    }

    let operation = if request.mode == "lossless" {
        pdf_ops::merge_lossless(&request.items, &output)
    } else {
        let temp = tempfile::tempdir().map_err(|error| error.to_string())?;
        let pages = pdf_ops::prepare_layout_pages(&request.items, temp.path(), request.dpi)?;
        pdf_ops::images_to_pdf(
            &pages,
            &output,
            &request.page_preset,
            &request.orientation,
            &request.background,
            request.quality,
        )
    };

    let joined_inputs = request
        .items
        .iter()
        .map(|item| item.path.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let item = match operation {
        Ok(()) => JobResult {
            input: joined_inputs,
            output: Some(output.to_string_lossy().to_string()),
            success: true,
            message: None,
        },
        Err(message) => JobResult {
            input: joined_inputs,
            output: None,
            success: false,
            message: Some(message),
        },
    };
    Ok(BatchResult {
        items: vec![item],
        output_dir: output
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_string_lossy()
            .to_string(),
    })
}

#[tauri::command]
pub async fn combine_files(request: CombineRequest) -> Result<BatchResult, String> {
    tauri::async_runtime::spawn_blocking(move || combine_sync(request))
        .await
        .map_err(|error| error.to_string())?
}

fn split_sync(request: SplitRequest) -> Result<BatchResult, String> {
    let input = PathBuf::from(&request.input);
    if !input.is_file() {
        return Err("Исходный файл не найден".to_string());
    }
    let output_dir = PathBuf::from(&request.output_dir);
    ensure_directory(&output_dir)?;

    let result = match request.mode.as_str() {
        "pages" if extension(&input) == "pdf" => {
            pdf_ops::split_pdf(&input, &output_dir, request.pages_per_file)
        }
        "render" if extension(&input) == "pdf" => pdf_ops::render_pdf(
            &input,
            &output_dir,
            &request.target_format,
            request.dpi,
            request.quality,
        ),
        "tiles" => {
            let source_format = extension(&input);
            if image_ops::is_native_image_format(&source_format) {
                image_ops::split_tiles(
                    &input,
                    &output_dir,
                    request.rows,
                    request.columns,
                    request.quality,
                )
            } else if matches!(source_format.as_str(), "avif" | "heic" | "heif" | "svg") {
                let temp = tempfile::tempdir().map_err(|error| error.to_string())?;
                let decoded = temp.path().join(format!("{}.png", stem(&input)));
                external_ops::convert_media(
                    &input,
                    &decoded,
                    "png",
                    &crate::model::ConversionOptions::default(),
                )?;
                image_ops::split_tiles(
                    &decoded,
                    &output_dir,
                    request.rows,
                    request.columns,
                    request.quality,
                )
            } else {
                Err("Этот формат изображения нельзя разделить на плитки".to_string())
            }
        }
        "duration" => {
            external_ops::split_media(&input, &output_dir, request.segment_seconds)
        }
        _ => Err("Этот режим не подходит выбранному файлу".to_string()),
    };

    let items = match result {
        Ok(outputs) => outputs
            .into_iter()
            .map(|output| JobResult {
                input: request.input.clone(),
                output: Some(output.to_string_lossy().to_string()),
                success: true,
                message: None,
            })
            .collect(),
        Err(message) => vec![JobResult {
            input: request.input,
            output: None,
            success: false,
            message: Some(message),
        }],
    };
    Ok(BatchResult {
        items,
        output_dir: output_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn split_file(request: SplitRequest) -> Result<BatchResult, String> {
    tauri::async_runtime::spawn_blocking(move || split_sync(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err("Путь результата больше не существует".to_string());
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        if target.is_file() {
            command.arg(format!("/select,{}", target.display()));
        } else {
            command.arg(&target);
        }
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        if target.is_file() {
            command.arg("-R");
        }
        command.arg(&target);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(if target.is_file() {
            target.parent().unwrap_or_else(|| Path::new("."))
        } else {
            target.as_path()
        });
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Не удалось открыть папку: {error}"))
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://"))
        || url.len() > 2_048
        || url.chars().any(char::is_whitespace)
    {
        return Err("Разрешены только обычные HTTP/HTTPS-ссылки".to_string());
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", &url]);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(&url);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(&url);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Не удалось открыть ссылку: {error}"))
}
