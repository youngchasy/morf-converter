use std::{
    fs::File,
    io::BufWriter,
    path::{Path, PathBuf},
};

use image::{
    codecs::jpeg::JpegEncoder,
    imageops::FilterType,
    DynamicImage, ExtendedColorType, GenericImageView, ImageFormat,
};

use crate::{
    model::ConversionOptions,
    util::{collision_free_path, ensure_directory, extension, stem},
};

pub const NATIVE_IMAGE_FORMATS: &[&str] =
    &["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "gif", "ico"];

pub fn is_native_image_format(value: &str) -> bool {
    NATIVE_IMAGE_FORMATS.contains(&value.trim_start_matches('.').to_ascii_lowercase().as_str())
}

pub fn rotate(image: DynamicImage, degrees: u16) -> DynamicImage {
    match degrees % 360 {
        90 => image.rotate90(),
        180 => image.rotate180(),
        270 => image.rotate270(),
        _ => image,
    }
}

fn transformed(input: &Path, options: &ConversionOptions) -> Result<DynamicImage, String> {
    let mut image =
        image::open(input).map_err(|error| format!("Не удалось открыть {}: {error}", input.display()))?;
    image = rotate(image, options.rotation);
    if options.grayscale {
        image = image.grayscale();
    }

    if options.width.is_some() || options.height.is_some() {
        let (source_width, source_height) = image.dimensions();
        let requested_width = options.width.map(|value| value.clamp(1, 32_768));
        let requested_height = options.height.map(|value| value.clamp(1, 32_768));
        let width = requested_width.unwrap_or_else(|| {
            ((source_width as f64) * requested_height.unwrap_or(source_height) as f64
                / source_height as f64)
                .round()
                .clamp(1.0, 32_768.0) as u32
        });
        let height = requested_height.unwrap_or_else(|| {
            ((source_height as f64) * requested_width.unwrap_or(source_width) as f64
                / source_width as f64)
                .round()
                .clamp(1.0, 32_768.0) as u32
        });
        image = match options.fit.as_str() {
            "cover" => image.resize_to_fill(width, height, FilterType::Lanczos3),
            "stretch" => image.resize_exact(width, height, FilterType::Lanczos3),
            _ => image.resize(width, height, FilterType::Lanczos3),
        };
    }

    if let Some(path) = options
        .watermark_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        image = apply_watermark(image, Path::new(path), options)?;
    }
    Ok(image)
}

fn apply_watermark(
    image: DynamicImage,
    watermark_path: &Path,
    options: &ConversionOptions,
) -> Result<DynamicImage, String> {
    let mut canvas = image.to_rgba8();
    let source = image::open(watermark_path).map_err(|error| {
        format!(
            "Не удалось открыть водяной знак {}: {error}",
            watermark_path.display()
        )
    })?;
    let fraction = f64::from(options.watermark_scale.clamp(2, 80)) / 100.0;
    let max_width = f64::from(canvas.width().max(1)) * fraction;
    let max_height = f64::from(canvas.height().max(1)) * fraction;
    let scale = (max_width / f64::from(source.width().max(1)))
        .min(max_height / f64::from(source.height().max(1)));
    let target_width = (f64::from(source.width().max(1)) * scale)
        .round()
        .clamp(1.0, f64::from(canvas.width().max(1))) as u32;
    let target_height = (f64::from(source.height().max(1)) * scale)
        .round()
        .clamp(1.0, f64::from(canvas.height().max(1))) as u32;
    let mut mark = source
        .resize(target_width, target_height, FilterType::Lanczos3)
        .to_rgba8();
    let opacity = u16::from(options.watermark_opacity.clamp(1, 100));
    for pixel in mark.pixels_mut() {
        pixel.0[3] = ((u16::from(pixel.0[3]) * opacity) / 100) as u8;
    }

    let margin = (canvas.width().min(canvas.height()) / 50).max(8);
    let max_x = canvas.width().saturating_sub(mark.width() + margin);
    let max_y = canvas.height().saturating_sub(mark.height() + margin);
    let (x, y) = match options.watermark_position.as_str() {
        "top-left" => (margin, margin),
        "top-right" => (max_x, margin),
        "bottom-left" => (margin, max_y),
        "center" => (
            canvas.width().saturating_sub(mark.width()) / 2,
            canvas.height().saturating_sub(mark.height()) / 2,
        ),
        _ => (max_x, max_y),
    };
    image::imageops::overlay(&mut canvas, &mark, i64::from(x), i64::from(y));
    Ok(DynamicImage::ImageRgba8(canvas))
}

pub fn write_image(
    image: &DynamicImage,
    output: &Path,
    target_format: &str,
    quality: u8,
) -> Result<(), String> {
    let format = target_format.trim_start_matches('.').to_ascii_lowercase();
    if matches!(format.as_str(), "jpg" | "jpeg") {
        let file = File::create(output)
            .map_err(|error| format!("Не удалось создать {}: {error}", output.display()))?;
        let writer = BufWriter::new(file);
        let rgb = image.to_rgb8();
        let (width, height) = rgb.dimensions();
        JpegEncoder::new_with_quality(writer, quality.clamp(1, 100))
            .encode(&rgb, width, height, ExtendedColorType::Rgb8)
            .map_err(|error| format!("Не удалось записать JPEG: {error}"))?;
        return Ok(());
    }

    let image_format = match format.as_str() {
        "png" => ImageFormat::Png,
        "webp" => ImageFormat::WebP,
        "bmp" => ImageFormat::Bmp,
        "tif" | "tiff" => ImageFormat::Tiff,
        "gif" => ImageFormat::Gif,
        "ico" => ImageFormat::Ico,
        _ => return Err(format!("Нативная запись .{format} пока не поддерживается")),
    };

    image
        .save_with_format(output, image_format)
        .map_err(|error| format!("Не удалось записать {}: {error}", output.display()))
}

pub fn convert(
    input: &Path,
    output: &Path,
    target_format: &str,
    options: &ConversionOptions,
) -> Result<(), String> {
    let image = transformed(input, options)?;
    write_image(&image, output, target_format, options.quality)
}

pub fn split_tiles(
    input: &Path,
    output_dir: &Path,
    rows: u32,
    columns: u32,
    quality: u8,
) -> Result<Vec<PathBuf>, String> {
    if rows == 0 || columns == 0 || rows > 100 || columns > 100 {
        return Err("Сетка должна быть от 1×1 до 100×100".to_string());
    }
    ensure_directory(output_dir)?;
    let image =
        image::open(input).map_err(|error| format!("Не удалось открыть {}: {error}", input.display()))?;
    let (width, height) = image.dimensions();
    let output_extension = match extension(input).as_str() {
        value if is_native_image_format(value) => value.to_string(),
        _ => "png".to_string(),
    };
    let base = stem(input);
    let mut outputs = Vec::with_capacity((rows * columns) as usize);

    for row in 0..rows {
        for column in 0..columns {
            let left = width * column / columns;
            let right = width * (column + 1) / columns;
            let top = height * row / rows;
            let bottom = height * (row + 1) / rows;
            let tile = image.crop_imm(left, top, right - left, bottom - top);
            let output = collision_free_path(
                output_dir,
                &format!("{base}-r{}-c{}", row + 1, column + 1),
                &output_extension,
                false,
            );
            write_image(&tile, &output, &output_extension, quality)?;
            outputs.push(output);
        }
    }
    Ok(outputs)
}
