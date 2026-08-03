use std::{
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    process::Output,
};

use crate::engines;

pub fn extension(path: &Path) -> String {
    path.extension()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase()
}

pub fn stem(path: &Path) -> String {
    path.file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("file")
        .to_string()
}

pub fn ensure_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("Не удалось создать папку {}: {error}", path.display()))
}

pub fn collision_free_path(
    directory: &Path,
    base_name: &str,
    target_extension: &str,
    overwrite: bool,
) -> PathBuf {
    let clean_extension = target_extension.trim_start_matches('.');
    let first = directory.join(format!("{base_name}.{clean_extension}"));
    if overwrite || !first.exists() {
        return first;
    }

    for index in 2..10_000 {
        let candidate = directory.join(format!("{base_name}-{index}.{clean_extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    directory.join(format!(
        "{base_name}-{}.{}",
        uuid::Uuid::new_v4().simple(),
        clean_extension
    ))
}

pub fn run_checked(executable: &Path, arguments: &[String]) -> Result<Output, String> {
    let output = engines::command(executable)
        .args(arguments)
        .output()
        .map_err(|error| format!("Не удалось запустить {}: {error}", executable.display()))?;

    if output.status.success() {
        Ok(output)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        let mut lines = detail.lines().rev().take(24).collect::<Vec<_>>();
        lines.reverse();
        let compact = lines.join("\n");
        let compact = if compact.chars().count() > 6_000 {
            format!(
                "…{}",
                compact
                    .chars()
                    .rev()
                    .take(5_999)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect::<String>()
            )
        } else {
            compact
        };
        Err(format!(
            "{} завершился с ошибкой{}{}",
            executable.display(),
            if compact.is_empty() { "" } else { ": " },
            compact
        ))
    }
}

pub fn parse_hex_color(value: &str) -> (u8, u8, u8) {
    let value = value.trim().trim_start_matches('#');
    if value.len() != 6 {
        return (255, 255, 255);
    }
    let parse = |range: std::ops::Range<usize>| u8::from_str_radix(&value[range], 16).ok();
    match (parse(0..2), parse(2..4), parse(4..6)) {
        (Some(red), Some(green), Some(blue)) => (red, green, blue),
        _ => (255, 255, 255),
    }
}

pub fn collect_matching_files(
    directory: &Path,
    prefix: &str,
    extension: &str,
) -> Result<Vec<PathBuf>, String> {
    let mut files = fs::read_dir(directory)
        .map_err(|error| format!("Не удалось прочитать {}: {error}", directory.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(OsStr::to_str)
                .is_some_and(|name| name.starts_with(prefix))
                && self::extension(path) == extension.trim_start_matches('.')
        })
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::parse_hex_color;

    #[test]
    fn parses_css_hex_colors_and_falls_back_to_white() {
        assert_eq!(parse_hex_color("#147d6f"), (20, 125, 111));
        assert_eq!(parse_hex_color("bad"), (255, 255, 255));
    }
}
