mod emulator_views;
mod updater;
#[cfg(target_os = "android")]
mod android_updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default().plugin(tauri_plugin_process::init());

  let builder = tauri_updater_kit::attach_updater(builder);

  builder
    .manage(emulator_views::EmulatorViews::default())
    .invoke_handler(tauri::generate_handler![
      emulator_views::open_emulator,
      emulator_views::close_emulator,
      updater::native_update_permission_status,
      updater::native_update_request_permission,
      updater::native_update_check,
      updater::native_update_download,
      updater::native_update_install,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
