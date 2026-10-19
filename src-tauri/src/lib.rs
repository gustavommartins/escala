mod commands;
mod video;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            commands::manage(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::probe_video,
            commands::thumbnail,
            commands::convert_video,
            commands::cancel_conversion,
            commands::cancel_all,
            commands::recommended_parallelism,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
