use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::Value;

use crate::{
    engines::find_engine,
    util::{collision_free_path, ensure_directory, extension, run_checked, stem},
};

pub fn read(path: &str) -> Result<Value, String> {
    let input = Path::new(path);
    if !input.is_file() {
        return Err("Файл не найден".to_string());
    }
    let exiftool =
        find_engine("exiftool").ok_or_else(|| "ExifTool не найден".to_string())?;
    let arguments = vec![
        "-j".to_string(),
        "-G1".to_string(),
        "-n".to_string(),
        input.to_string_lossy().to_string(),
    ];
    let output = run_checked(&exiftool, &arguments)?;
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("ExifTool вернул некорректный JSON: {error}"))
}

pub fn strip_copy(path: &str, output_dir: &str) -> Result<PathBuf, String> {
    let input = Path::new(path);
    if !input.is_file() {
        return Err("Файл не найден".to_string());
    }
    let directory = PathBuf::from(output_dir);
    ensure_directory(&directory)?;
    let file_extension = extension(input);
    let output = collision_free_path(
        &directory,
        &format!("{}-clean", stem(input)),
        &file_extension,
        false,
    );
    fs::copy(input, &output)
        .map_err(|error| format!("Не удалось создать безопасную копию: {error}"))?;
    let exiftool =
        find_engine("exiftool").ok_or_else(|| "ExifTool не найден".to_string())?;
    let arguments = vec![
        "-all=".to_string(),
        "-overwrite_original".to_string(),
        output.to_string_lossy().to_string(),
    ];
    if let Err(error) = run_checked(&exiftool, &arguments) {
        let _ = fs::remove_file(&output);
        return Err(error);
    }
    Ok(output)
}

pub fn copy_all(input: &Path, output: &Path) -> Result<(), String> {
    if !input.is_file() || !output.is_file() {
        return Err("Не удалось сохранить метаданные: вход или результат не найден".to_string());
    }
    let exiftool =
        find_engine("exiftool").ok_or_else(|| "Для сохранения метаданных нужен ExifTool".to_string())?;
    let arguments = vec![
        "-TagsFromFile".to_string(),
        input.to_string_lossy().to_string(),
        "-all:all".to_string(),
        "-overwrite_original".to_string(),
        output.to_string_lossy().to_string(),
    ];
    run_checked(&exiftool, &arguments).map(|_| ())
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use crate::engines;

    use super::{copy_all, read, strip_copy};

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent")
            .join("tests")
            .join("fixtures")
            .join(name)
    }

    #[test]
    fn reads_and_strips_a_real_image_when_exiftool_is_available() {
        if engines::find_engine("exiftool").is_none() {
            return;
        }
        let input = fixture("gradient.jpg");
        let metadata = read(&input.to_string_lossy()).unwrap();
        assert!(metadata.is_array());

        let output = tempfile::tempdir().unwrap();
        let clean = strip_copy(
            &input.to_string_lossy(),
            &output.path().to_string_lossy(),
        )
        .unwrap();
        assert!(clean.is_file());
        assert_ne!(clean, input);
        copy_all(&input, &clean).unwrap();
    }
}
