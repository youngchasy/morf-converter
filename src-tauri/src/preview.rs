use std::{io::Cursor, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine};
use image::ImageFormat;

use crate::{
    external_ops,
    model::ConversionOptions,
    pdf_ops,
    util::extension,
};

fn encode_thumbnail(path: &Path, max_size: u32) -> Result<String, String> {
    let image = image::open(path)
        .map_err(|error| format!("Не удалось открыть превью {}: {error}", path.display()))?;
    let thumbnail = image.thumbnail(max_size, max_size);
    let mut bytes = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut bytes, ImageFormat::Png)
        .map_err(|error| format!("Не удалось закодировать превью: {error}"))?;
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(bytes.into_inner())
    ))
}

pub fn thumbnail(path: &str, page: usize, max_size: u32) -> Result<String, String> {
    let input = Path::new(path);
    if !input.is_file() {
        return Err("Файл для превью не найден".to_string());
    }
    let max_size = max_size.clamp(64, 1200);
    if extension(input) == "pdf" {
        let temp = tempfile::tempdir().map_err(|error| error.to_string())?;
        let prefix = temp.path().join("page");
        let rendered = pdf_ops::render_one_page(input, page.max(1), &prefix, 120)?;
        return encode_thumbnail(&rendered, max_size);
    }
    if matches!(extension(input).as_str(), "avif" | "heic" | "heif" | "svg") {
        let temp = tempfile::tempdir().map_err(|error| error.to_string())?;
        let decoded = temp.path().join("thumbnail.png");
        external_ops::convert_media(
            input,
            &decoded,
            "png",
            &ConversionOptions::default(),
        )?;
        return encode_thumbnail(&decoded, max_size);
    }
    encode_thumbnail(input, max_size)
}
