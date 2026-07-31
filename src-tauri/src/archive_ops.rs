use std::{
    collections::HashSet,
    fs::{self, File},
    io::{self, BufReader, BufWriter},
    path::{Path, PathBuf},
};

use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::{
    engines::find_engine,
    model::{ArchiveCreateRequest, ArchiveExtractRequest},
    util::{ensure_directory, extension, run_checked},
};

fn unique_name(name: String, used: &mut HashSet<String>) -> String {
    if used.insert(name.clone()) {
        return name;
    }
    let path = Path::new(&name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let suffix = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    for index in 2..10_000 {
        let candidate = format!("{stem}-{index}{suffix}");
        if used.insert(candidate.clone()) {
            return candidate;
        }
    }
    format!("{stem}-{}{suffix}", uuid::Uuid::new_v4().simple())
}

fn append_directory(
    writer: &mut ZipWriter<BufWriter<File>>,
    source: &Path,
    archive_root: &Path,
    options: SimpleFileOptions,
) -> Result<(), String> {
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Не удалось прочитать {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let archive_path = archive_root.join(entry.file_name());
        let archive_name = archive_path.to_string_lossy().replace('\\', "/");
        if metadata.is_dir() {
            writer
                .add_directory(format!("{archive_name}/"), options.clone())
                .map_err(|error| format!("Не удалось добавить папку в ZIP: {error}"))?;
            append_directory(writer, &path, &archive_path, options.clone())?;
        } else if metadata.is_file() {
            writer
                .start_file(archive_name, options.clone())
                .map_err(|error| format!("Не удалось добавить файл в ZIP: {error}"))?;
            let mut input = BufReader::new(
                File::open(&path)
                    .map_err(|error| format!("Не удалось открыть {}: {error}", path.display()))?,
            );
            io::copy(&mut input, writer)
                .map_err(|error| format!("Не удалось записать ZIP: {error}"))?;
        }
    }
    Ok(())
}

fn create_zip(inputs: &[String], output: &Path) -> Result<PathBuf, String> {
    if let Some(parent) = output.parent() {
        ensure_directory(parent)?;
    }
    if output.exists() {
        return Err("Архив с таким именем уже существует".to_string());
    }
    let file = File::create(output)
        .map_err(|error| format!("Не удалось создать {}: {error}", output.display()))?;
    let mut writer = ZipWriter::new(BufWriter::new(file));
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let mut used = HashSet::new();

    for value in inputs {
        let path = Path::new(value);
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("Не удалось прочитать {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
            .to_string();
        let archive_name = unique_name(name, &mut used);
        if metadata.is_dir() {
            writer
                .add_directory(format!("{archive_name}/"), options.clone())
                .map_err(|error| format!("Не удалось добавить папку в ZIP: {error}"))?;
            append_directory(
                &mut writer,
                path,
                Path::new(&archive_name),
                options.clone(),
            )?;
        } else if metadata.is_file() {
            writer
                .start_file(archive_name, options.clone())
                .map_err(|error| format!("Не удалось добавить файл в ZIP: {error}"))?;
            let mut input = BufReader::new(
                File::open(path)
                    .map_err(|error| format!("Не удалось открыть {}: {error}", path.display()))?,
            );
            io::copy(&mut input, &mut writer)
                .map_err(|error| format!("Не удалось записать ZIP: {error}"))?;
        }
    }
    writer
        .finish()
        .map_err(|error| format!("Не удалось завершить ZIP: {error}"))?;
    Ok(output.to_path_buf())
}

pub fn create(request: ArchiveCreateRequest) -> Result<PathBuf, String> {
    if request.inputs.is_empty() {
        return Err("Не выбраны файлы для архива".to_string());
    }
    let output = PathBuf::from(&request.output_path);
    let format = request
        .format
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if format == "zip" {
        return create_zip(&request.inputs, &output);
    }
    let seven_zip =
        find_engine("7zip").ok_or_else(|| "Для этого формата требуется 7-Zip".to_string())?;
    if let Some(parent) = output.parent() {
        ensure_directory(parent)?;
    }
    if output.exists() {
        return Err("Архив с таким именем уже существует".to_string());
    }
    let mut arguments = vec![
        "a".to_string(),
        "-y".to_string(),
        output.to_string_lossy().to_string(),
    ];
    arguments.extend(request.inputs);
    run_checked(&seven_zip, &arguments)?;
    Ok(output)
}

fn collect_files(directory: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Не удалось прочитать {}: {error}", directory.display()))?
    {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_dir() {
            collect_files(&path, output)?;
        } else if path.is_file() {
            output.push(path);
        }
    }
    Ok(())
}

fn collision_free_extracted_file(target: &Path) -> PathBuf {
    if !target.exists() {
        return target.to_path_buf();
    }
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let stem = target
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    for index in 2..10_000 {
        let candidate = parent.join(format!("{stem}-{index}{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!(
        "{stem}-{}{extension}",
        uuid::Uuid::new_v4().simple()
    ))
}

fn extract_zip(input: &Path, output_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let file = File::open(input)
        .map_err(|error| format!("Не удалось открыть {}: {error}", input.display()))?;
    let mut archive =
        ZipArchive::new(BufReader::new(file)).map_err(|error| format!("Повреждённый ZIP: {error}"))?;
    let mut outputs = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Не удалось прочитать ZIP: {error}"))?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("ZIP содержит символическую ссылку; распаковка остановлена".to_string());
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "ZIP содержит небезопасный путь".to_string())?
            .to_path_buf();
        let mut target = output_dir.join(enclosed);
        if entry.is_dir() {
            ensure_directory(&target)?;
            continue;
        }
        target = collision_free_extracted_file(&target);
        if let Some(parent) = target.parent() {
            ensure_directory(parent)?;
        }
        let mut output = File::create(&target)
            .map_err(|error| format!("Не удалось создать {}: {error}", target.display()))?;
        io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Не удалось распаковать {}: {error}", target.display()))?;
        outputs.push(target);
    }
    Ok(outputs)
}

pub fn extract(request: ArchiveExtractRequest) -> Result<Vec<PathBuf>, String> {
    let input = PathBuf::from(&request.input);
    if !input.is_file() {
        return Err("Архив не найден".to_string());
    }
    let output_dir = PathBuf::from(&request.output_dir);
    ensure_directory(&output_dir)?;
    if extension(&input) == "zip" {
        return extract_zip(&input, &output_dir);
    }
    let mut before = Vec::new();
    collect_files(&output_dir, &mut before)?;
    let before = before.into_iter().collect::<HashSet<_>>();
    let seven_zip =
        find_engine("7zip").ok_or_else(|| "Для этого формата требуется 7-Zip".to_string())?;
    let arguments = vec![
        "x".to_string(),
        "-y".to_string(),
        "-aou".to_string(),
        format!("-o{}", output_dir.display()),
        input.to_string_lossy().to_string(),
    ];
    run_checked(&seven_zip, &arguments)?;
    let mut outputs = Vec::new();
    collect_files(&output_dir, &mut outputs)?;
    outputs.retain(|path| !before.contains(path));
    outputs.sort();
    Ok(outputs)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::model::{ArchiveCreateRequest, ArchiveExtractRequest};

    use super::{create, extract};

    #[test]
    fn creates_and_safely_extracts_zip() {
        let temp = tempfile::tempdir().unwrap();
        let input = temp.path().join("hello.txt");
        fs::write(&input, "Morf archive fixture").unwrap();
        let archive = temp.path().join("fixture.zip");
        create(ArchiveCreateRequest {
            inputs: vec![input.to_string_lossy().to_string()],
            output_path: archive.to_string_lossy().to_string(),
            format: "zip".to_string(),
        })
        .unwrap();
        let output = temp.path().join("output");
        let files = extract(ArchiveExtractRequest {
            input: archive.to_string_lossy().to_string(),
            output_dir: output.to_string_lossy().to_string(),
        })
        .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(fs::read_to_string(&files[0]).unwrap(), "Morf archive fixture");
    }

    #[test]
    fn creates_and_extracts_7z_when_engine_is_available() {
        if crate::engines::find_engine("7zip").is_none() {
            return;
        }
        let temp = tempfile::tempdir().unwrap();
        let input = temp.path().join("hello.txt");
        fs::write(&input, "Morf 7Z fixture").unwrap();
        let archive = temp.path().join("fixture.7z");
        create(ArchiveCreateRequest {
            inputs: vec![input.to_string_lossy().to_string()],
            output_path: archive.to_string_lossy().to_string(),
            format: "7z".to_string(),
        })
        .unwrap();
        let output = temp.path().join("output-7z");
        let files = extract(ArchiveExtractRequest {
            input: archive.to_string_lossy().to_string(),
            output_dir: output.to_string_lossy().to_string(),
        })
        .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(fs::read_to_string(&files[0]).unwrap(), "Morf 7Z fixture");
    }
}
