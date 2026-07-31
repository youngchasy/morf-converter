use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use crate::{
    engines::find_engine,
    model::ConversionOptions,
    util::{extension, run_checked},
};

const VIDEO_FORMATS: &[&str] = &[
    "mp4", "mkv", "mov", "webm", "avi", "mpeg", "mpg", "m4v", "m2ts", "mts", "flv",
    "3gp", "ogv",
];
const AUDIO_FORMATS: &[&str] = &[
    "mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma", "aiff", "ac3",
];

pub fn is_media_format(value: &str) -> bool {
    let value = value.trim_start_matches('.').to_ascii_lowercase();
    VIDEO_FORMATS.contains(&value.as_str()) || AUDIO_FORMATS.contains(&value.as_str())
}

pub fn convert_media(
    input: &Path,
    output: &Path,
    target_format: &str,
    options: &ConversionOptions,
) -> Result<(), String> {
    let ffmpeg = find_engine("ffmpeg").ok_or_else(|| "FFmpeg не найден".to_string())?;
    let target = target_format.trim_start_matches('.').to_ascii_lowercase();
    let requested_encoder = if options.hardware_encoder == "auto" {
        detect_hardware_encoder(&ffmpeg)
    } else if options.hardware_encoder.trim().is_empty() {
        "software".to_string()
    } else {
        options.hardware_encoder.clone()
    };
    let output_existed = output.exists();
    let arguments = media_arguments(input, output, &target, options, &requested_encoder);
    match run_checked(&ffmpeg, &arguments) {
        Ok(_) => Ok(()),
        Err(first_error) if requested_encoder != "software" => {
            if !output_existed {
                let _ = fs::remove_file(output);
            }
            let fallback = media_arguments(input, output, &target, options, "software");
            run_checked(&ffmpeg, &fallback).map(|_| ()).map_err(|fallback_error| {
                format!(
                    "Аппаратный кодировщик недоступен ({first_error}). Программный режим тоже завершился ошибкой: {fallback_error}"
                )
            })
        }
        Err(error) => Err(error),
    }
}

fn detect_hardware_encoder(ffmpeg: &Path) -> String {
    let output = Command::new(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output();
    let Ok(output) = output else {
        return "software".to_string();
    };
    let listing = String::from_utf8_lossy(&output.stdout);
    [
        ("videotoolbox", "h264_videotoolbox"),
        ("nvenc", "h264_nvenc"),
        ("qsv", "h264_qsv"),
        ("amf", "h264_amf"),
    ]
    .into_iter()
    .find(|(_, codec)| listing.contains(codec))
    .map(|(id, _)| id.to_string())
    .unwrap_or_else(|| "software".to_string())
}

fn escape_subtitle_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('\'', "\\'")
        .replace(',', "\\,")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

fn overlay_position(value: &str) -> &'static str {
    match value {
        "top-left" => "20:20",
        "top-right" => "W-w-20:20",
        "bottom-left" => "20:H-h-20",
        "center" => "(W-w)/2:(H-h)/2",
        _ => "W-w-20:H-h-20",
    }
}

fn media_arguments(
    input: &Path,
    output: &Path,
    target: &str,
    options: &ConversionOptions,
    encoder: &str,
) -> Vec<String> {
    let mut arguments = vec!["-hide_banner".to_string(), "-nostdin".to_string(), "-n".to_string()];
    if let Some(start) = options.trim_start.filter(|value| *value > 0.0) {
        arguments.push("-ss".to_string());
        arguments.push(format!("{start:.3}"));
    }
    arguments.push("-i".to_string());
    arguments.push(input.to_string_lossy().to_string());
    let has_watermark = options
        .watermark_path
        .as_deref()
        .is_some_and(|path| !path.trim().is_empty())
        && !AUDIO_FORMATS.contains(&target);
    if let Some(path) = options.watermark_path.as_deref().filter(|_| has_watermark) {
        arguments.push("-i".to_string());
        arguments.push(path.to_string());
    }
    let mux_subtitles = options.subtitle_mode == "mux"
        && options
            .subtitle_path
            .as_deref()
            .is_some_and(|path| !path.trim().is_empty())
        && matches!(target, "mp4" | "mkv" | "mov" | "m4v" | "webm");
    let subtitle_input = if has_watermark { 2 } else { 1 };
    if let Some(path) = options
        .subtitle_path
        .as_deref()
        .filter(|_| mux_subtitles)
    {
        arguments.push("-i".to_string());
        arguments.push(path.to_string());
    }
    if let Some(duration) = options.trim_duration.filter(|value| *value > 0.0) {
        arguments.push("-t".to_string());
        arguments.push(format!("{duration:.3}"));
    }

    if AUDIO_FORMATS.contains(&target) {
        arguments.push("-vn".to_string());
        if !matches!(target, "wav" | "flac") {
            arguments.push("-b:a".to_string());
            arguments.push(format!("{}k", options.audio_bitrate.clamp(32, 512)));
        }
    } else {
        let mut filters = Vec::new();
        if options.width.is_some() || options.height.is_some() {
            let video_output = VIDEO_FORMATS.contains(&target);
            let dimension = |value: u32| {
                let value = value.clamp(if video_output { 2 } else { 1 }, 32_768);
                if video_output {
                    value & !1
                } else {
                    value
                }
            };
            match (options.width.map(dimension), options.height.map(dimension)) {
                (Some(width), Some(height)) if options.fit == "cover" => {
                    filters.push(format!(
                        "scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
                    ));
                }
                (Some(width), Some(height)) if options.fit == "stretch" => {
                    filters.push(format!("scale={width}:{height}"));
                }
                (Some(width), Some(height)) => {
                    filters.push(format!(
                        "scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
                    ));
                }
                (Some(width), None) => filters.push(format!("scale={width}:-2")),
                (None, Some(height)) => filters.push(format!("scale=-2:{height}")),
                (None, None) => {}
            }
        }
        match options.rotation % 360 {
            90 => filters.push("transpose=1".to_string()),
            180 => filters.push("transpose=1,transpose=1".to_string()),
            270 => filters.push("transpose=2".to_string()),
            _ => {}
        }
        if options.grayscale {
            filters.push("hue=s=0".to_string());
        }
        if options.subtitle_mode == "burn" {
            if let Some(path) = options
                .subtitle_path
                .as_deref()
                .filter(|path| !path.trim().is_empty())
            {
                filters.push(format!(
                    "subtitles=filename='{}'",
                    escape_subtitle_path(Path::new(path))
                ));
            }
        }
        if has_watermark {
            let opacity = f32::from(options.watermark_opacity.clamp(1, 100)) / 100.0;
            let scale = f32::from(options.watermark_scale.clamp(2, 80)) / 100.0;
            let mut complex = String::new();
            let video_label = if filters.is_empty() {
                "[0:v]".to_string()
            } else {
                complex.push_str(&format!("[0:v]{}[base];", filters.join(",")));
                "[base]".to_string()
            };
            complex.push_str(&format!(
                "[1:v]format=rgba,colorchannelmixer=aa={opacity:.2}[wmraw];[wmraw]{video_label}scale2ref=w=main_w*{scale:.3}:h=ow/mdar[wm][video];[video][wm]overlay={}[vout]",
                overlay_position(&options.watermark_position)
            ));
            arguments.extend([
                "-filter_complex".to_string(),
                complex,
                "-map".to_string(),
                "[vout]".to_string(),
                "-map".to_string(),
                "0:a?".to_string(),
            ]);
        } else if !filters.is_empty() {
            arguments.push("-vf".to_string());
            arguments.push(filters.join(","));
        }
        let crf = 35_i32 - (i32::from(options.quality.clamp(1, 100)) * 20 / 100);
        match target {
            "mp4" | "mov" | "m4v" | "mkv" if encoder != "software" => {
                let codec = match encoder {
                    "nvenc" => "h264_nvenc",
                    "videotoolbox" => "h264_videotoolbox",
                    "qsv" => "h264_qsv",
                    "amf" => "h264_amf",
                    _ => "libx264",
                };
                let bitrate = 600 + u32::from(options.quality.clamp(1, 100)) * 114;
                arguments.extend([
                    "-c:v".to_string(),
                    codec.to_string(),
                    "-b:v".to_string(),
                    format!("{bitrate}k"),
                    "-pix_fmt".to_string(),
                    "yuv420p".to_string(),
                ]);
                if matches!(target, "mp4" | "mov" | "m4v") {
                    arguments.extend(["-movflags".to_string(), "+faststart".to_string()]);
                }
            }
            "mp4" | "mov" | "m4v" | "mkv" => {
                arguments.extend([
                    "-c:v".to_string(),
                    "libx264".to_string(),
                    "-crf".to_string(),
                    crf.to_string(),
                    "-pix_fmt".to_string(),
                    "yuv420p".to_string(),
                ]);
                if matches!(target, "mp4" | "mov" | "m4v") {
                    arguments.extend(["-movflags".to_string(), "+faststart".to_string()]);
                }
            }
            "webm" => {
                arguments.extend([
                    "-c:v".to_string(),
                    "libvpx-vp9".to_string(),
                    "-crf".to_string(),
                    crf.to_string(),
                    "-b:v".to_string(),
                    "0".to_string(),
                ]);
            }
            "jpg" | "jpeg" | "png" | "webp" | "avif" => {
                arguments.extend(["-frames:v".to_string(), "1".to_string()]);
            }
            _ => {}
        }
        if mux_subtitles {
            if !has_watermark {
                arguments.extend([
                    "-map".to_string(),
                    "0:v?".to_string(),
                    "-map".to_string(),
                    "0:a?".to_string(),
                ]);
            }
            arguments.extend([
                "-map".to_string(),
                format!("{subtitle_input}:0"),
                "-c:s".to_string(),
                if matches!(target, "mp4" | "mov" | "m4v") {
                    "mov_text".to_string()
                } else if target == "webm" {
                    "webvtt".to_string()
                } else if options
                    .subtitle_path
                    .as_deref()
                    .is_some_and(|path| extension(Path::new(path)) == "ass")
                {
                    "ass".to_string()
                } else {
                    "srt".to_string()
                },
            ]);
        }
        if matches!(target, "mp4" | "mov" | "m4v") {
            arguments.extend(["-c:a".to_string(), "aac".to_string()]);
        } else if target == "webm" {
            arguments.extend(["-c:a".to_string(), "libopus".to_string()]);
        }
    }
    arguments.push(output.to_string_lossy().to_string());
    arguments
}

pub fn convert_document(
    input: &Path,
    output: &Path,
    target_format: &str,
) -> Result<(), String> {
    let source = extension(input);
    let target = target_format.trim_start_matches('.').to_ascii_lowercase();
    let markup_source = matches!(
        source.as_str(),
        "md" | "markdown" | "html" | "htm"
    );
    let pandoc_document_source = matches!(source.as_str(), "docx" | "odt" | "epub");
    let markup_target = matches!(
        target.as_str(),
        "md" | "markdown" | "html" | "htm" | "epub"
    );

    if (markup_source
        && (markup_target || matches!(target.as_str(), "docx" | "odt" | "txt")))
        || (pandoc_document_source && markup_target)
        || (source == "epub" && matches!(target.as_str(), "docx" | "odt" | "txt"))
    {
        return run_pandoc(input, output);
    }

    if matches!(source.as_str(), "doc" | "rtf") && markup_target {
        let temp = tempfile::tempdir().map_err(|error| error.to_string())?;
        let intermediate = run_libreoffice(input, temp.path(), "docx")?;
        return run_pandoc(&intermediate, output);
    }

    if (markup_source || source == "epub") && target == "pdf" {
        let temp = tempfile::tempdir().map_err(|error| error.to_string())?;
        let intermediate = temp.path().join("morf-intermediate.docx");
        run_pandoc(input, &intermediate)?;
        let produced = run_libreoffice(&intermediate, temp.path(), "pdf")?;
        return fs::copy(&produced, output)
            .map(|_| ())
            .map_err(|error| format!("Не удалось сохранить {}: {error}", output.display()));
    }

    let temp = tempfile::tempdir().map_err(|error| error.to_string())?;
    let produced = run_libreoffice(input, temp.path(), &target)?;
    fs::copy(&produced, output)
        .map(|_| ())
        .map_err(|error| format!("Не удалось сохранить {}: {error}", output.display()))
}

fn run_pandoc(input: &Path, output: &Path) -> Result<(), String> {
    let pandoc = find_engine("pandoc").ok_or_else(|| "Pandoc не найден".to_string())?;
    let arguments = vec![
        input.to_string_lossy().to_string(),
        "--standalone".to_string(),
        "-o".to_string(),
        output.to_string_lossy().to_string(),
    ];
    run_checked(&pandoc, &arguments).map(|_| ())
}

fn run_libreoffice(
    input: &Path,
    output_dir: &Path,
    target: &str,
) -> Result<PathBuf, String> {
    let libreoffice =
        find_engine("libreoffice").ok_or_else(|| "LibreOffice не найден".to_string())?;
    let arguments = vec![
        "--headless".to_string(),
        "--nologo".to_string(),
        "--nodefault".to_string(),
        "--nolockcheck".to_string(),
        "--convert-to".to_string(),
        target.to_string(),
        "--outdir".to_string(),
        output_dir.to_string_lossy().to_string(),
        input.to_string_lossy().to_string(),
    ];
    run_checked(&libreoffice, &arguments)?;
    let produced = output_dir.join(format!(
        "{}.{}",
        input
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("document"),
        target
    ));
    if !produced.exists() {
        return Err(format!(
            "LibreOffice не создал ожидаемый файл .{target}. Возможно, эта пара форматов не поддерживается."
        ));
    }
    Ok(produced)
}

pub fn split_media(
    input: &Path,
    output_dir: &Path,
    segment_seconds: u32,
) -> Result<Vec<PathBuf>, String> {
    let ffmpeg = find_engine("ffmpeg").ok_or_else(|| "FFmpeg не найден".to_string())?;
    let source_extension = extension(input);
    let base = input
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("media");
    let mut prefix = format!("{base}-part");
    let mut counter = 2;
    while fs::read_dir(output_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .any(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(&prefix))
        })
    {
        prefix = format!("{base}-part-{counter}");
        counter += 1;
    }
    let pattern = output_dir.join(format!("{prefix}-%03d.{source_extension}"));
    let arguments = vec![
        "-hide_banner".to_string(),
        "-nostdin".to_string(),
        "-n".to_string(),
        "-i".to_string(),
        input.to_string_lossy().to_string(),
        "-map".to_string(),
        "0".to_string(),
        "-c".to_string(),
        "copy".to_string(),
        "-f".to_string(),
        "segment".to_string(),
        "-segment_time".to_string(),
        segment_seconds.clamp(1, 86_400).to_string(),
        "-reset_timestamps".to_string(),
        "1".to_string(),
        pattern.to_string_lossy().to_string(),
    ];
    run_checked(&ffmpeg, &arguments)?;
    let mut outputs = fs::read_dir(output_dir)
        .map_err(|error| format!("Не удалось прочитать папку результатов: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name.starts_with(&format!("{prefix}-")))
                && extension(path) == source_extension
        })
        .collect::<Vec<_>>();
    outputs.sort();
    if outputs.is_empty() {
        Err("FFmpeg завершился без созданных сегментов".to_string())
    } else {
        Ok(outputs)
    }
}
