use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::{
    engines::find_engine,
    model::OcrRequest,
    pdf_ops,
    util::{collision_free_path, ensure_directory, extension, run_checked, stem},
};

fn validate_language(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 64
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "_+-".contains(character))
    {
        return Err("Некорректный код языка OCR".to_string());
    }
    Ok(value.to_string())
}

fn recognize_page(
    tesseract: &Path,
    input: &Path,
    output_base: &Path,
    language: &str,
    format: &str,
) -> Result<PathBuf, String> {
    let arguments = vec![
        input.to_string_lossy().to_string(),
        output_base.to_string_lossy().to_string(),
        "-l".to_string(),
        language.to_string(),
        format.to_string(),
    ];
    run_checked(tesseract, &arguments)?;
    let result = output_base.with_extension(format);
    if result.exists() {
        Ok(result)
    } else {
        Err(format!("Tesseract не создал {}", result.display()))
    }
}

pub fn run(request: OcrRequest) -> Result<PathBuf, String> {
    let input = PathBuf::from(&request.input);
    if !input.is_file() {
        return Err("Файл для OCR не найден".to_string());
    }
    let output_dir = PathBuf::from(&request.output_dir);
    ensure_directory(&output_dir)?;
    let language = validate_language(&request.language)?;
    let format = request.output_format.trim().to_ascii_lowercase();
    if !matches!(format.as_str(), "txt" | "pdf") {
        return Err("OCR выводит только TXT или PDF".to_string());
    }
    let tesseract =
        find_engine("tesseract").ok_or_else(|| "Tesseract OCR не найден".to_string())?;
    let output = collision_free_path(
        &output_dir,
        &format!("{}-ocr", stem(&input)),
        &format,
        false,
    );

    if extension(&input) != "pdf" {
        let base = output.with_extension("");
        return recognize_page(&tesseract, &input, &base, &language, &format);
    }

    let temp = tempfile::tempdir().map_err(|error| error.to_string())?;
    let pages = pdf_ops::render_pdf(&input, temp.path(), "png", 220, 90)?;
    if pages.is_empty() {
        return Err("В PDF нет страниц для распознавания".to_string());
    }
    let mut recognized = Vec::with_capacity(pages.len());
    for (index, page) in pages.iter().enumerate() {
        let base = temp.path().join(format!("ocr-page-{}", index + 1));
        recognized.push(recognize_page(&tesseract, page, &base, &language, &format)?);
    }

    if format == "txt" {
        let mut combined = String::new();
        for (index, path) in recognized.iter().enumerate() {
            if index > 0 {
                combined.push_str(&format!("\n\n--- Страница {} ---\n\n", index + 1));
            }
            combined.push_str(
                &fs::read_to_string(path)
                    .map_err(|error| format!("Не удалось прочитать OCR: {error}"))?,
            );
        }
        fs::write(&output, combined)
            .map_err(|error| format!("Не удалось сохранить {}: {error}", output.display()))?;
        return Ok(output);
    }

    let qpdf = find_engine("qpdf")
        .ok_or_else(|| "Для многостраничного OCR PDF требуется qpdf".to_string())?;
    let mut arguments = vec!["--empty".to_string(), "--pages".to_string()];
    arguments.extend(
        recognized
            .iter()
            .map(|path| path.to_string_lossy().to_string()),
    );
    arguments.push("--".to_string());
    arguments.push(output.to_string_lossy().to_string());
    run_checked(&qpdf, &arguments)?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use crate::{engines, model::OcrRequest};

    use super::run;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent")
            .join("tests")
            .join("fixtures")
            .join(name)
    }

    #[test]
    fn recognizes_a_real_image_when_tesseract_is_available() {
        if engines::find_engine("tesseract").is_none() {
            return;
        }
        let output = tempfile::tempdir().unwrap();
        let result = run(OcrRequest {
            input: fixture("gradient-320x180.png")
                .to_string_lossy()
                .to_string(),
            output_dir: output.path().to_string_lossy().to_string(),
            language: "eng".to_string(),
            output_format: "txt".to_string(),
        })
        .unwrap();
        assert!(result.is_file());
    }
}
