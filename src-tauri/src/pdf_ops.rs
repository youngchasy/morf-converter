use std::{
    fs,
    path::{Path, PathBuf},
};

use image::{
    codecs::jpeg::JpegEncoder, imageops, DynamicImage, ExtendedColorType, GenericImageView, Rgba,
    RgbaImage,
};
use lopdf::{dictionary, Document, Object, Stream};

use crate::{
    engines::{find_engine, find_related_command},
    external_ops, image_ops,
    model::{CombineItem, ConversionOptions},
    util::{
        collect_matching_files, collision_free_path, ensure_directory, parse_hex_color,
        run_checked, stem,
    },
};

#[derive(Debug, Clone)]
pub struct ImagePageSpec {
    pub path: PathBuf,
    pub scale: u16,
    pub rotation: u16,
    pub margin: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub border_width: f32,
    pub border_color: String,
    pub fit: String,
}

impl ImagePageSpec {
    pub fn from_combine_item(item: &CombineItem, path: PathBuf) -> Self {
        Self {
            path,
            scale: item.scale,
            rotation: item.rotation,
            margin: item.margin,
            offset_x: item.offset_x,
            offset_y: item.offset_y,
            border_width: item.border_width,
            border_color: item.border_color.clone(),
            fit: item.fit.clone(),
        }
    }
}

fn page_count(input: &Path) -> Result<usize, String> {
    Document::load(input)
        .map(|document| document.get_pages().len())
        .map_err(|error| format!("Не удалось прочитать PDF {}: {error}", input.display()))
}

fn page_number(token: &str, count: usize) -> Result<usize, String> {
    let token = token.trim();
    if token.eq_ignore_ascii_case("z") {
        return Ok(count);
    }
    if let Some(reverse) = token.strip_prefix('r') {
        let from_end = reverse
            .parse::<usize>()
            .map_err(|_| format!("Некорректная страница: {token}"))?;
        if from_end == 0 {
            return Err(format!("Некорректная страница: {token}"));
        }
        return Ok(count
            .saturating_add(1)
            .saturating_sub(from_end)
            .clamp(1, count));
    }
    token
        .parse::<usize>()
        .map(|value| value.clamp(1, count.max(1)))
        .map_err(|_| format!("Некорректная страница: {token}"))
}

pub fn parse_page_range(value: &str, count: usize) -> Result<Vec<usize>, String> {
    if count == 0 {
        return Ok(Vec::new());
    }
    let value = value.trim();
    if value.is_empty() || value == "1-z" {
        return Ok((1..=count).collect());
    }

    let mut pages = Vec::new();
    for raw_segment in value.split(',') {
        let (segment, modifier) = raw_segment
            .split_once(':')
            .map_or((raw_segment, None), |(range, modifier)| {
                (range, Some(modifier))
            });
        if segment.starts_with('x') {
            return Err(
                "Исключающие диапазоны поддерживаются только в режиме «без потерь»".to_string(),
            );
        }
        let mut segment_pages = if let Some((left, right)) = segment.split_once('-') {
            let start = page_number(left, count)?;
            let end = page_number(right, count)?;
            if start <= end {
                (start..=end).collect::<Vec<_>>()
            } else {
                (end..=start).rev().collect::<Vec<_>>()
            }
        } else {
            vec![page_number(segment, count)?]
        };
        match modifier {
            Some("odd") => segment_pages.retain(|page| page % 2 == 1),
            Some("even") => segment_pages.retain(|page| page % 2 == 0),
            Some(other) => return Err(format!("Неизвестный модификатор страниц: {other}")),
            None => {}
        }
        pages.extend(segment_pages);
    }
    Ok(pages)
}

fn encode_jpeg(image: &DynamicImage, background: &str, quality: u8) -> Result<Vec<u8>, String> {
    let (red, green, blue) = parse_hex_color(background);
    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut canvas = RgbaImage::from_pixel(width, height, Rgba([red, green, blue, 255]));
    imageops::overlay(&mut canvas, &rgba, 0, 0);
    let rgb = DynamicImage::ImageRgba8(canvas).to_rgb8();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, quality.clamp(1, 100))
        .encode(&rgb, width, height, ExtendedColorType::Rgb8)
        .map_err(|error| format!("Не удалось подготовить изображение для PDF: {error}"))?;
    Ok(bytes)
}

fn oriented_page_size(
    preset: &str,
    orientation: &str,
    image_width: u32,
    image_height: u32,
    margin: f32,
) -> (f32, f32) {
    let (mut width, mut height) = match preset {
        "letter" => (612.0, 792.0),
        "source" => (
            image_width as f32 * 0.75 + margin * 2.0,
            image_height as f32 * 0.75 + margin * 2.0,
        ),
        _ => (595.28, 841.89),
    };
    let wants_landscape = orientation == "landscape";
    if wants_landscape != (width > height) {
        std::mem::swap(&mut width, &mut height);
    }
    (width.max(1.0), height.max(1.0))
}

pub fn images_to_pdf(
    pages: &[ImagePageSpec],
    output: &Path,
    page_preset: &str,
    orientation: &str,
    background: &str,
    quality: u8,
) -> Result<(), String> {
    if pages.is_empty() {
        return Err("Нет страниц для PDF".to_string());
    }
    if let Some(parent) = output.parent() {
        ensure_directory(parent)?;
    }

    let mut document = Document::with_version("1.5");
    let pages_id = document.new_object_id();
    let mut page_ids = Vec::with_capacity(pages.len());
    let (bg_red, bg_green, bg_blue) = parse_hex_color(background);

    for page in pages {
        let image = image::open(&page.path)
            .map_err(|error| format!("Не удалось открыть {}: {error}", page.path.display()))?;
        let image = image_ops::rotate(image, page.rotation);
        let (pixel_width, pixel_height) = image.dimensions();
        let jpeg = encode_jpeg(&image, background, quality)?;
        let image_id = document.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => i64::from(pixel_width),
                "Height" => i64::from(pixel_height),
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
                "Filter" => "DCTDecode",
            },
            jpeg,
        ));
        let resources_id = document.add_object(dictionary! {
            "XObject" => dictionary! { "Im0" => image_id },
        });

        let margin = page.margin.max(0.0);
        let (page_width, page_height) =
            oriented_page_size(page_preset, orientation, pixel_width, pixel_height, margin);
        let available_width = (page_width - margin * 2.0).max(1.0);
        let available_height = (page_height - margin * 2.0).max(1.0);
        let source_width = pixel_width as f32;
        let source_height = pixel_height as f32;
        let base_scale = match page.fit.as_str() {
            "cover" => (available_width / source_width).max(available_height / source_height),
            "original" => 0.75,
            _ => (available_width / source_width).min(available_height / source_height),
        };
        let scale = base_scale * (page.scale.clamp(1, 500) as f32 / 100.0);
        let draw_width = source_width * scale;
        let draw_height = source_height * scale;
        let x = (page_width - draw_width) / 2.0 + page.offset_x;
        let y = (page_height - draw_height) / 2.0 + page.offset_y;
        let bg = (
            bg_red as f32 / 255.0,
            bg_green as f32 / 255.0,
            bg_blue as f32 / 255.0,
        );
        let (border_red, border_green, border_blue) = parse_hex_color(&page.border_color);

        let mut content = format!(
            "q\n{:.5} {:.5} {:.5} rg\n0 0 {:.3} {:.3} re f\nQ\nq\n{:.3} 0 0 {:.3} {:.3} {:.3} cm\n/Im0 Do\nQ\n",
            bg.0, bg.1, bg.2, page_width, page_height, draw_width, draw_height, x, y
        );
        if page.border_width > 0.0 {
            content.push_str(&format!(
                "q\n{:.5} {:.5} {:.5} RG\n{:.3} w\n{:.3} {:.3} {:.3} {:.3} re S\nQ\n",
                border_red as f32 / 255.0,
                border_green as f32 / 255.0,
                border_blue as f32 / 255.0,
                page.border_width,
                x,
                y,
                draw_width,
                draw_height
            ));
        }
        let content_id = document.add_object(Stream::new(dictionary! {}, content.into_bytes()));
        let page_id = document.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Resources" => resources_id,
            "Contents" => content_id,
            "MediaBox" => vec![0.into(), 0.into(), page_width.into(), page_height.into()],
        });
        page_ids.push(page_id);
    }

    document.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => page_ids.iter().copied().map(Object::Reference).collect::<Vec<_>>(),
            "Count" => page_ids.len() as i64,
        }),
    );
    let catalog_id = document.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    document.trailer.set("Root", catalog_id);
    document.compress();
    document
        .save(output)
        .map(|_| ())
        .map_err(|error| format!("Не удалось сохранить PDF {}: {error}", output.display()))
}

pub fn single_image_to_pdf(
    input: &Path,
    output: &Path,
    options: &ConversionOptions,
) -> Result<(), String> {
    let temp = tempfile::tempdir().map_err(|error| error.to_string())?;
    let transformed = temp.path().join("image.jpg");
    image_ops::convert(input, &transformed, "jpg", options)?;
    let spec = ImagePageSpec {
        path: transformed,
        scale: 100,
        rotation: 0,
        margin: 0.0,
        offset_x: 0.0,
        offset_y: 0.0,
        border_width: 0.0,
        border_color: "#000000".to_string(),
        fit: "contain".to_string(),
    };
    images_to_pdf(
        &[spec],
        output,
        "source",
        "portrait",
        "#ffffff",
        options.quality,
    )
}

pub fn merge_lossless(items: &[CombineItem], output: &Path) -> Result<(), String> {
    let qpdf = find_engine("qpdf").ok_or_else(|| "qpdf не найден".to_string())?;
    if items.is_empty()
        || items
            .iter()
            .any(|item| !matches!(item.kind, crate::model::FileKind::Pdf))
    {
        return Err("Режим без потерь принимает только PDF".to_string());
    }
    if let Some(parent) = output.parent() {
        ensure_directory(parent)?;
    }
    let mut arguments = vec!["--empty".to_string(), "--pages".to_string()];
    for item in items {
        arguments.push(item.path.clone());
        arguments.push(if item.page_range.trim().is_empty() {
            "1-z".to_string()
        } else {
            item.page_range.clone()
        });
    }
    arguments.push("--".to_string());
    arguments.push(output.to_string_lossy().to_string());
    run_checked(&qpdf, &arguments).map(|_| ())
}

pub(crate) fn render_one_page(
    input: &Path,
    page: usize,
    output_prefix: &Path,
    dpi: u16,
) -> Result<PathBuf, String> {
    let poppler =
        find_engine("poppler").ok_or_else(|| "Poppler (pdftoppm) не найден".to_string())?;
    let arguments = vec![
        "-f".to_string(),
        page.to_string(),
        "-l".to_string(),
        page.to_string(),
        "-singlefile".to_string(),
        "-r".to_string(),
        dpi.clamp(36, 600).to_string(),
        "-png".to_string(),
        input.to_string_lossy().to_string(),
        output_prefix.to_string_lossy().to_string(),
    ];
    run_checked(&poppler, &arguments)?;
    let rendered = output_prefix.with_extension("png");
    if rendered.exists() {
        Ok(rendered)
    } else {
        Err(format!("Poppler не создал {}", rendered.display()))
    }
}

pub fn prepare_layout_pages(
    items: &[CombineItem],
    temp_dir: &Path,
    dpi: u16,
) -> Result<Vec<ImagePageSpec>, String> {
    let mut pages = Vec::new();
    for (item_index, item) in items.iter().enumerate() {
        let input = Path::new(&item.path);
        match item.kind {
            crate::model::FileKind::Image => {
                let source_format = crate::util::extension(input);
                if image_ops::is_native_image_format(&source_format) {
                    pages.push(ImagePageSpec::from_combine_item(item, input.to_path_buf()));
                } else if matches!(source_format.as_str(), "avif" | "heic" | "heif" | "svg") {
                    let decoded = temp_dir.join(format!("image-{item_index}.png"));
                    external_ops::convert_media(
                        input,
                        &decoded,
                        "png",
                        &ConversionOptions::default(),
                    )?;
                    pages.push(ImagePageSpec::from_combine_item(item, decoded));
                } else {
                    return Err(format!("{} нельзя декодировать как изображение", item.name));
                }
            }
            crate::model::FileKind::Pdf => {
                let count = page_count(input)?;
                let selection = parse_page_range(&item.page_range, count)?;
                for (selection_index, page_number) in selection.into_iter().enumerate() {
                    let prefix = temp_dir.join(format!("pdf-{item_index}-page-{selection_index}"));
                    let rendered = render_one_page(input, page_number, &prefix, dpi)?;
                    pages.push(ImagePageSpec::from_combine_item(item, rendered));
                }
            }
            _ => return Err(format!("{} нельзя добавить в PDF-макет", item.name)),
        }
    }
    Ok(pages)
}

pub fn split_pdf(
    input: &Path,
    output_dir: &Path,
    pages_per_file: u32,
) -> Result<Vec<PathBuf>, String> {
    let qpdf = find_engine("qpdf").ok_or_else(|| "qpdf не найден".to_string())?;
    ensure_directory(output_dir)?;
    let base = stem(input);
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
    let pattern = output_dir.join(format!("{prefix}-%d.pdf"));
    let arguments = vec![
        format!("--split-pages={}", pages_per_file.clamp(1, 10_000)),
        input.to_string_lossy().to_string(),
        pattern.to_string_lossy().to_string(),
    ];
    run_checked(&qpdf, &arguments)?;
    let outputs = collect_matching_files(output_dir, &prefix, "pdf")?;
    if outputs.is_empty() {
        Err("qpdf завершился без созданных частей".to_string())
    } else {
        Ok(outputs)
    }
}

pub fn render_pdf(
    input: &Path,
    output_dir: &Path,
    target_format: &str,
    dpi: u16,
    quality: u8,
) -> Result<Vec<PathBuf>, String> {
    ensure_directory(output_dir)?;
    let count = page_count(input)?;
    if count == 0 {
        return Err("В PDF нет страниц".to_string());
    }
    let base = stem(input);
    let format = target_format.trim_start_matches('.').to_ascii_lowercase();
    let mut outputs = Vec::with_capacity(count);

    if format == "txt" {
        let executable = find_related_command("poppler", "pdftotext")
            .ok_or_else(|| "Poppler (pdftotext) не найден".to_string())?;
        for page in 1..=count {
            let output =
                collision_free_path(output_dir, &format!("{base}-page-{page}"), "txt", false);
            let arguments = vec![
                "-f".to_string(),
                page.to_string(),
                "-l".to_string(),
                page.to_string(),
                "-layout".to_string(),
                input.to_string_lossy().to_string(),
                output.to_string_lossy().to_string(),
            ];
            run_checked(&executable, &arguments)?;
            outputs.push(output);
        }
        return Ok(outputs);
    }

    if !matches!(format.as_str(), "png" | "jpg" | "jpeg") {
        return Err("PDF можно вывести в PNG, JPEG или TXT".to_string());
    }
    let poppler =
        find_engine("poppler").ok_or_else(|| "Poppler (pdftoppm) не найден".to_string())?;
    for page in 1..=count {
        let extension = if format == "jpeg" {
            "jpg"
        } else {
            format.as_str()
        };
        let output =
            collision_free_path(output_dir, &format!("{base}-page-{page}"), extension, false);
        let prefix = output.with_extension("");
        let mut arguments = vec![
            "-f".to_string(),
            page.to_string(),
            "-l".to_string(),
            page.to_string(),
            "-singlefile".to_string(),
            "-r".to_string(),
            dpi.clamp(36, 600).to_string(),
        ];
        if extension == "png" {
            arguments.push("-png".to_string());
        } else {
            arguments.push("-jpeg".to_string());
            arguments.push("-jpegopt".to_string());
            arguments.push(format!("quality={}", quality.clamp(1, 100)));
        }
        arguments.push(input.to_string_lossy().to_string());
        arguments.push(prefix.to_string_lossy().to_string());
        run_checked(&poppler, &arguments)?;
        if output.exists() {
            outputs.push(output);
        } else {
            return Err(format!("Poppler не создал {}", output.display()));
        }
    }
    Ok(outputs)
}

#[cfg(test)]
mod tests {
    use super::parse_page_range;

    #[test]
    fn parses_forward_reverse_and_last_page_ranges() {
        assert_eq!(parse_page_range("1-3", 5).unwrap(), vec![1, 2, 3]);
        assert_eq!(parse_page_range("z-3", 5).unwrap(), vec![5, 4, 3]);
        assert_eq!(parse_page_range("3,1-2", 5).unwrap(), vec![3, 1, 2]);
        assert_eq!(parse_page_range("r1", 5).unwrap(), vec![5]);
        assert!(parse_page_range("r0", 5).is_err());
    }
}
