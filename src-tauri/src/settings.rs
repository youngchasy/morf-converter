use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

use crate::model::AppSettings;

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("settings.json"))
        .map_err(|error| format!("Не удалось определить папку настроек: {error}"))
}

pub fn load(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Не удалось прочитать {}: {error}", path.display()))?;
    let mut settings = serde_json::from_str::<AppSettings>(&content)
        .map_err(|error| format!("Настройки повреждены: {error}"))?;
    settings.max_parallel_jobs = settings.max_parallel_jobs.clamp(1, 8);
    Ok(settings)
}

pub fn save(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Не удалось создать {}: {error}", parent.display()))?;
    }
    let content = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Не удалось подготовить настройки: {error}"))?;
    fs::write(&path, content)
        .map_err(|error| format!("Не удалось сохранить {}: {error}", path.display()))
}
