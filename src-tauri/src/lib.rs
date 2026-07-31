mod archive_ops;
mod commands;
mod conversion;
mod engines;
mod external_ops;
mod image_ops;
mod jobs;
mod metadata_ops;
mod model;
mod ocr_ops;
mod pdf_ops;
mod preview;
mod settings;
mod text_ops;
mod util;

use std::sync::Mutex;

use tauri::Manager;

pub(crate) struct OpenedFiles(pub Mutex<Vec<String>>);

fn argument_files() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(OpenedFiles(Mutex::new(argument_files())))
        .manage(jobs::JobManager::new());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        use tauri::Emitter;

        let paths = argv
            .into_iter()
            .skip(1)
            .map(std::path::PathBuf::from)
            .filter(|path| path.is_file())
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        if !paths.is_empty() {
            let _ = app.emit("open-files", paths);
            show_main_window(app);
        }
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Ok(value) = settings::load(app.handle()) {
                engines::set_custom_paths(&value.engine_paths);
                app.state::<jobs::JobManager>()
                    .set_limit(value.max_parallel_jobs);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::inspect_paths,
            commands::detect_engines,
            commands::start_conversion_job,
            commands::get_job,
            commands::list_jobs,
            commands::pause_job,
            commands::resume_job,
            commands::cancel_job,
            commands::get_settings,
            commands::save_settings,
            commands::engine_install_plans,
            commands::initial_files,
            commands::file_thumbnail,
            commands::convert_files,
            commands::combine_files,
            commands::split_file,
            commands::run_ocr,
            commands::create_archive,
            commands::extract_archive,
            commands::read_metadata,
            commands::strip_metadata_copy,
            commands::reveal_path,
            commands::open_external_url,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Morf")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                use tauri::Emitter;

                let paths = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|path| path.is_file())
                    .map(|path| path.to_string_lossy().to_string())
                    .collect::<Vec<_>>();
                if paths.is_empty() {
                    return;
                }
                if let Ok(mut pending) = _app.state::<OpenedFiles>().0.lock() {
                    pending.extend(paths.iter().cloned());
                }
                let _ = _app.emit("open-files", paths);
                show_main_window(_app);
            }
        });
}
