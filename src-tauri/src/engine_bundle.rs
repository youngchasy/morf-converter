use std::{
    fs::{self, File},
    io::{BufReader, Read},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock, RwLock,
    },
};

use flate2::read::GzDecoder;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::process::background_command;

#[derive(Clone, Debug)]
pub struct BundleRuntime {
    pub environment: PathBuf,
    pub libreoffice_executable: PathBuf,
}

#[derive(Clone, Debug)]
struct BundleConfig {
    pack_dir: PathBuf,
    data_dir: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundleManifest {
    schema: u32,
    mode: String,
    bundle_version: String,
    environment_archive: Option<String>,
    environment_sha256: Option<String>,
    unpacker: Option<String>,
    libreoffice_archive: Option<String>,
    libreoffice_sha256: Option<String>,
    libreoffice_executable: Option<String>,
}

static CONFIG: OnceLock<BundleConfig> = OnceLock::new();
static RUNTIME: OnceLock<RwLock<Option<BundleRuntime>>> = OnceLock::new();
static INSTALL_LOCK: Mutex<()> = Mutex::new(());
static SYSTEM_MODE: AtomicBool = AtomicBool::new(false);

fn runtime_state() -> &'static RwLock<Option<BundleRuntime>> {
    RUNTIME.get_or_init(|| RwLock::new(None))
}

pub fn configure(resource_dir: PathBuf, data_dir: PathBuf) {
    let _ = CONFIG.set(BundleConfig {
        pack_dir: resource_dir.join("engine-pack"),
        data_dir,
    });
}

pub fn runtime() -> Option<BundleRuntime> {
    runtime_state().read().ok()?.clone()
}

fn safe_relative(value: &str, label: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if value.trim().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(format!("Некорректный путь {label} в комплекте движков"));
    }
    Ok(path.to_path_buf())
}

fn version_directory(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 96
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
    {
        return Err("Некорректная версия комплекта движков".to_string());
    }
    Ok(value)
}

fn read_manifest(config: &BundleConfig) -> Result<BundleManifest, String> {
    let path = config.pack_dir.join("manifest.json");
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Не удалось прочитать {}: {error}", path.display()))?;
    let manifest: BundleManifest = serde_json::from_str(&contents)
        .map_err(|error| format!("Некорректный manifest комплекта движков: {error}"))?;
    if manifest.schema != 1 {
        return Err(format!(
            "Версия manifest комплекта движков {} не поддерживается",
            manifest.schema
        ));
    }
    Ok(manifest)
}

fn required<'a>(value: &'a Option<String>, label: &str) -> Result<&'a str, String> {
    value
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("В комплекте движков отсутствует поле {label}"))
}

fn verify_sha256(path: &Path, expected: &str) -> Result<(), String> {
    if expected.len() != 64
        || !expected
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(format!("Некорректный SHA-256 для {}", path.display()));
    }
    let file = File::open(path)
        .map_err(|error| format!("Не удалось открыть {}: {error}", path.display()))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 128];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("Не удалось проверить {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!(
            "Комплект движков повреждён: SHA-256 {} не совпадает",
            path.display()
        ))
    }
}

fn compact_process_error(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    let mut lines = detail.lines().rev().take(18).collect::<Vec<_>>();
    lines.reverse();
    lines.join("\n")
}

fn unpack_environment(unpacker: &Path, archive: &Path, destination: &Path) -> Result<(), String> {
    let output = background_command(unpacker)
        .arg(archive)
        .current_dir(destination)
        .output()
        .map_err(|error| {
            format!(
                "Не удалось запустить распаковку встроенных движков {}: {error}",
                unpacker.display()
            )
        })?;
    if !output.status.success() {
        let detail = compact_process_error(&output);
        return Err(format!(
            "Не удалось подготовить встроенные движки{}{}",
            if detail.is_empty() { "" } else { ": " },
            detail
        ));
    }
    if !destination.join("env").is_dir() {
        return Err("Распаковщик не создал окружение встроенных движков".to_string());
    }
    Ok(())
}

fn unpack_tar_gz(archive: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "Не удалось создать папку LibreOffice {}: {error}",
            destination.display()
        )
    })?;
    let file = File::open(archive)
        .map_err(|error| format!("Не удалось открыть {}: {error}", archive.display()))?;
    let decoder = GzDecoder::new(BufReader::new(file));
    let mut tar = tar::Archive::new(decoder);
    tar.unpack(destination)
        .map_err(|error| format!("Не удалось распаковать LibreOffice: {error}"))
}

fn runtime_for(target: &Path, manifest: &BundleManifest) -> Result<BundleRuntime, String> {
    let libreoffice_relative = safe_relative(
        required(&manifest.libreoffice_executable, "libreofficeExecutable")?,
        "libreofficeExecutable",
    )?;
    let environment = target.join("env");
    let libreoffice_executable = target.join("libreoffice").join(libreoffice_relative);
    if !environment.is_dir() || !libreoffice_executable.is_file() {
        return Err("Установленный комплект движков неполон".to_string());
    }
    Ok(BundleRuntime {
        environment,
        libreoffice_executable,
    })
}

fn cleanup_old_versions(parent: &Path, active: &Path) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.as_path() == active || !path.is_dir() || !path.join(".ready").is_file() {
            continue;
        }
        let _ = fs::remove_dir_all(path);
    }
}

fn cleanup_stale_installs(parent: &Path) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_stale = path.is_dir()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(".install-"));
        if is_stale {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn install(config: &BundleConfig, manifest: &BundleManifest) -> Result<BundleRuntime, String> {
    let version = version_directory(&manifest.bundle_version)?;
    let packs_dir = config.data_dir.join("engine-packs");
    let target = packs_dir.join(version);
    if target.join(".ready").is_file() {
        if let Ok(runtime) = runtime_for(&target, manifest) {
            return Ok(runtime);
        }
    }

    fs::create_dir_all(&packs_dir).map_err(|error| {
        format!(
            "Не удалось создать папку движков {}: {error}",
            packs_dir.display()
        )
    })?;
    cleanup_stale_installs(&packs_dir);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|error| {
            format!(
                "Не удалось заменить неполный комплект {}: {error}",
                target.display()
            )
        })?;
    }

    let environment_archive = config.pack_dir.join(safe_relative(
        required(&manifest.environment_archive, "environmentArchive")?,
        "environmentArchive",
    )?);
    let unpacker = config.pack_dir.join(safe_relative(
        required(&manifest.unpacker, "unpacker")?,
        "unpacker",
    )?);
    let libreoffice_archive = config.pack_dir.join(safe_relative(
        required(&manifest.libreoffice_archive, "libreofficeArchive")?,
        "libreofficeArchive",
    )?);

    verify_sha256(
        &environment_archive,
        required(&manifest.environment_sha256, "environmentSha256")?,
    )?;
    verify_sha256(
        &libreoffice_archive,
        required(&manifest.libreoffice_sha256, "libreofficeSha256")?,
    )?;
    if !unpacker.is_file() {
        return Err(format!("Распаковщик {} не найден", unpacker.display()));
    }

    let temporary = packs_dir.join(format!(".install-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir_all(&temporary).map_err(|error| {
        format!(
            "Не удалось создать временную папку {}: {error}",
            temporary.display()
        )
    })?;

    let result: Result<BundleRuntime, String> = (|| {
        unpack_environment(&unpacker, &environment_archive, &temporary)?;
        unpack_tar_gz(&libreoffice_archive, &temporary.join("libreoffice"))?;
        let runtime = runtime_for(&temporary, manifest)?;
        fs::write(temporary.join(".ready"), &manifest.bundle_version)
            .map_err(|error| format!("Не удалось завершить подготовку движков: {error}"))?;
        fs::rename(&temporary, &target).map_err(|error| {
            format!(
                "Не удалось активировать комплект движков {}: {error}",
                target.display()
            )
        })?;
        let installed = BundleRuntime {
            environment: target.join(
                runtime
                    .environment
                    .strip_prefix(&temporary)
                    .unwrap_or(Path::new("env")),
            ),
            libreoffice_executable: target.join(
                runtime
                    .libreoffice_executable
                    .strip_prefix(&temporary)
                    .unwrap_or(Path::new("libreoffice")),
            ),
        };
        Ok(installed)
    })();

    if result.is_err() && temporary.exists() {
        let _ = fs::remove_dir_all(&temporary);
    }
    let runtime = result?;
    cleanup_old_versions(&packs_dir, &target);
    Ok(runtime)
}

/// Ensures the offline engine pack has been unpacked into a writable, stable
/// per-user location. Development builds use the `system` manifest and skip it.
pub fn ensure() -> Result<(), String> {
    if runtime().is_some() || SYSTEM_MODE.load(Ordering::Acquire) {
        return Ok(());
    }
    let Some(config) = CONFIG.get() else {
        return Ok(());
    };
    let _guard = INSTALL_LOCK
        .lock()
        .map_err(|_| "Подготовка движков была неожиданно прервана".to_string())?;
    if runtime().is_some() || SYSTEM_MODE.load(Ordering::Acquire) {
        return Ok(());
    }
    let manifest = read_manifest(config)?;
    if manifest.mode == "system" {
        SYSTEM_MODE.store(true, Ordering::Release);
        return Ok(());
    }
    if manifest.mode != "embedded" {
        return Err(format!(
            "Неизвестный режим комплекта движков: {}",
            manifest.mode
        ));
    }
    let installed = install(config, &manifest)?;
    let mut current = runtime_state()
        .write()
        .map_err(|_| "Не удалось активировать встроенные движки".to_string())?;
    *current = Some(installed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{safe_relative, version_directory};

    #[test]
    fn rejects_paths_that_escape_the_engine_pack() {
        assert!(safe_relative("../payload", "test").is_err());
        assert!(safe_relative("/payload", "test").is_err());
        assert!(safe_relative("environment.tar", "test").is_ok());
    }

    #[test]
    fn accepts_only_directory_safe_versions() {
        assert!(version_directory("0.1.0-alpha.2-engines.1").is_ok());
        assert!(version_directory("../../escape").is_err());
    }
}
