use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::{
    external_ops,
    image_ops,
    metadata_ops,
    model::{BatchResult, ConversionRequest, JobResult},
    pdf_ops, text_ops,
    util::{collision_free_path, ensure_directory, extension, stem},
};

fn validate_format(value: &str) -> Result<String, String> {
    let value = value.trim().trim_start_matches('.').to_ascii_lowercase();
    if value.is_empty()
        || value.len() > 12
        || !value.chars().all(|character| character.is_ascii_alphanumeric())
    {
        return Err("Некорректный формат результата".to_string());
    }
    Ok(value)
}

fn is_office_or_markup(value: &str) -> bool {
    matches!(
        value,
        "doc" | "docx"
            | "odt"
            | "rtf"
            | "xls"
            | "xlsx"
            | "ods"
            | "ppt"
            | "pptx"
            | "odp"
            | "epub"
            | "html"
            | "htm"
            | "md"
            | "markdown"
            | "xml"
    )
}

fn requires_ffmpeg(source: &str, target: &str) -> bool {
    external_ops::is_media_format(source)
        || external_ops::is_media_format(target)
        || matches!(source, "avif" | "heic" | "heif" | "svg")
        || matches!(target, "avif" | "heic" | "heif")
}

fn convert_one(
    input: &Path,
    output: &Path,
    source_format: &str,
    target_format: &str,
    request: &ConversionRequest,
) -> Result<Vec<PathBuf>, String> {
    if image_ops::is_native_image_format(source_format)
        && image_ops::is_native_image_format(target_format)
    {
        image_ops::convert(input, output, target_format, &request.options)?;
        return Ok(vec![output.to_path_buf()]);
    }

    if image_ops::is_native_image_format(source_format) && target_format == "pdf" {
        pdf_ops::single_image_to_pdf(input, output, &request.options)?;
        return Ok(vec![output.to_path_buf()]);
    }

    if matches!(source_format, "avif" | "heic" | "heif" | "svg")
        && target_format == "pdf"
    {
        let temp = tempfile::tempdir().map_err(|error| error.to_string())?;
        let raster = temp.path().join("decoded.png");
        let mut decode_options = request.options.clone();
        decode_options.width = None;
        decode_options.height = None;
        decode_options.rotation = 0;
        decode_options.grayscale = false;
        decode_options.watermark_path = None;
        decode_options.subtitle_path = None;
        decode_options.subtitle_mode = "off".to_string();
        external_ops::convert_media(input, &raster, "png", &decode_options)?;
        pdf_ops::single_image_to_pdf(&raster, output, &request.options)?;
        return Ok(vec![output.to_path_buf()]);
    }

    if source_format == "pdf" {
        if target_format == "pdf" {
            fs::copy(input, output)
                .map_err(|error| format!("Не удалось скопировать PDF: {error}"))?;
            return Ok(vec![output.to_path_buf()]);
        }
        if matches!(target_format, "png" | "jpg" | "jpeg" | "txt") {
            return pdf_ops::render_pdf(
                input,
                Path::new(&request.output_dir),
                target_format,
                150,
                request.options.quality,
            );
        }
        return Err("PDF напрямую конвертируется только в изображения или текст".to_string());
    }

    if text_ops::is_native_data_format(source_format)
        && text_ops::is_native_data_format(target_format)
    {
        text_ops::convert(input, output, source_format, target_format)?;
        return Ok(vec![output.to_path_buf()]);
    }

    if requires_ffmpeg(source_format, target_format)
        || (image_ops::is_native_image_format(target_format)
            && !is_office_or_markup(source_format))
    {
        external_ops::convert_media(input, output, target_format, &request.options)?;
        return Ok(vec![output.to_path_buf()]);
    }

    if is_office_or_markup(source_format)
        || is_office_or_markup(target_format)
        || target_format == "pdf"
    {
        external_ops::convert_document(input, output, target_format)?;
        return Ok(vec![output.to_path_buf()]);
    }

    Err(format!(
        "Пара .{source_format} → .{target_format} пока не поддерживается"
    ))
}

pub fn run_with_control<Progress, Checkpoint>(
    request: ConversionRequest,
    mut on_progress: Progress,
    mut checkpoint: Checkpoint,
) -> Result<BatchResult, String>
where
    Progress: FnMut(usize, usize, Option<&str>),
    Checkpoint: FnMut() -> Result<(), String>,
{
    if request.inputs.is_empty() {
        return Err("Очередь пуста".to_string());
    }
    let target_format = validate_format(&request.target_format)?;
    let output_dir = PathBuf::from(&request.output_dir);
    ensure_directory(&output_dir)?;
    let mut items = Vec::new();

    let total = request.inputs.len();
    on_progress(0, total, None);
    for (index, input_value) in request.inputs.iter().enumerate() {
        checkpoint()?;
        on_progress(index, total, Some(input_value));
        let input = PathBuf::from(input_value);
        if !input.is_file() {
            items.push(JobResult {
                input: input_value.clone(),
                output: None,
                success: false,
                message: Some("Исходный файл не найден".to_string()),
            });
            on_progress(index + 1, total, None);
            continue;
        }
        let source_format = extension(&input);
        let output = collision_free_path(
            &output_dir,
            &stem(&input),
            &target_format,
            false,
        );
        let output_existed = output.exists();
        if output == input {
            items.push(JobResult {
                input: input_value.clone(),
                output: None,
                success: false,
                message: Some("Нельзя перезаписывать исходный файл".to_string()),
            });
            on_progress(index + 1, total, None);
            continue;
        }

        match convert_one(
            &input,
            &output,
            &source_format,
            &target_format,
            &request,
        ) {
            Ok(outputs) => {
                for created in outputs {
                    if request.options.preserve_metadata {
                        if let Err(message) = metadata_ops::copy_all(&input, &created) {
                            let _ = fs::remove_file(&created);
                            items.push(JobResult {
                                input: input_value.clone(),
                                output: None,
                                success: false,
                                message: Some(message),
                            });
                            continue;
                        }
                    }
                    items.push(JobResult {
                        input: input_value.clone(),
                        output: Some(created.to_string_lossy().to_string()),
                        success: true,
                        message: None,
                    });
                }
            }
            Err(message) => {
                if !output_existed {
                    let _ = fs::remove_file(&output);
                }
                items.push(JobResult {
                    input: input_value.clone(),
                    output: None,
                    success: false,
                    message: Some(message),
                });
            }
        }
        on_progress(index + 1, total, None);
    }

    Ok(BatchResult {
        items,
        output_dir: output_dir.to_string_lossy().to_string(),
    })
}

pub fn run(request: ConversionRequest) -> Result<BatchResult, String> {
    run_with_control(request, |_, _, _| {}, || Ok(()))
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use crate::{
        engines,
        model::{ConversionOptions, ConversionRequest},
    };

    use super::run;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent")
            .join("tests")
            .join("fixtures")
            .join(name)
    }

    fn options() -> ConversionOptions {
        ConversionOptions {
            quality: 84,
            width: None,
            height: None,
            fit: "contain".to_string(),
            rotation: 0,
            grayscale: false,
            preserve_metadata: false,
            audio_bitrate: 160,
            trim_start: None,
            trim_duration: None,
            hardware_encoder: "software".to_string(),
            watermark_path: None,
            watermark_opacity: 70,
            watermark_scale: 22,
            watermark_position: "bottom-right".to_string(),
            subtitle_path: None,
            subtitle_mode: "off".to_string(),
        }
    }

    fn convert(name: &str, target: &str) {
        let output = tempfile::tempdir().unwrap();
        let result = run(ConversionRequest {
            inputs: vec![fixture(name).to_string_lossy().to_string()],
            output_dir: output.path().to_string_lossy().to_string(),
            target_format: target.to_string(),
            overwrite: false,
            options: options(),
        })
        .unwrap();
        assert!(
            result.items.iter().all(|item| item.success),
            "{:?}",
            result.items
        );
        assert!(result
            .items
            .iter()
            .filter_map(|item| item.output.as_ref())
            .all(|path| Path::new(path).is_file()));
    }

    #[test]
    fn converts_native_image_and_data_fixtures() {
        convert("gradient-320x180.png", "jpg");
        convert("data.json", "yaml");
        convert("data.xml", "json");
        convert("gradient-320x180.png", "pdf");
    }

    #[test]
    fn converts_real_media_when_ffmpeg_is_available() {
        if engines::find_engine("ffmpeg").is_none() {
            return;
        }
        convert("video-2s.mp4", "mp3");
        convert("tone-440hz.wav", "flac");
    }

    #[test]
    fn renders_real_pdf_when_poppler_is_available() {
        if engines::find_engine("poppler").is_none() {
            return;
        }
        convert("two-pages.pdf", "png");
    }

    #[test]
    fn converts_document_when_libreoffice_is_available() {
        if engines::find_engine("libreoffice").is_none() {
            return;
        }
        convert("document.rtf", "pdf");
    }
}
