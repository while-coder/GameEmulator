use tauri::{AppHandle, Webview};

#[cfg(desktop)]
use tauri::{webview::PageLoadEvent, Emitter, LogicalPosition, Manager, WebviewBuilder, WebviewUrl};

// Serializes creation/closure. Never create native webviews in a synchronous
// command: WebView2 creation must be allowed to dispatch to the main thread.
#[derive(Default)]
pub struct EmulatorViews(#[cfg(desktop)] pub std::sync::Mutex<()>);

#[tauri::command]
pub async fn open_emulator(app: AppHandle, caller: Webview, id: String) -> Result<(), String> {
    if caller.label() != "main" || !["nes", "arcade"].contains(&id.as_str()) {
        return Err("不支持的模拟器入口".into());
    }
    #[cfg(desktop)]
    {
        let state = app.state::<EmulatorViews>();
        let _guard = state.0.lock().map_err(|e| e.to_string())?;
        if ["emulator-nes", "emulator-arcade"]
            .iter()
            .any(|label| app.get_webview(label).is_some())
        {
            return Err("模拟器已打开".into());
        }
        let window = caller.window();
        window.show().map_err(|e| e.to_string())?;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let view = window
            .add_child(
                WebviewBuilder::new(
                    format!("emulator-{id}"),
                    WebviewUrl::App(format!("{id}.html?child=1").into()),
                )
                .on_page_load(|view, payload| {
                    if payload.event() != PageLoadEvent::Finished {
                        return;
                    }
                    // Switch only after the child document has finished loading.
                    if let Some(main) = view.app_handle().get_webview("main") {
                        if let Err(err) = main.hide()
                            .and_then(|_| view.set_focus())
                            .and_then(|_| view.emit_to("main", "emulator-ready", ()))
                        {
                            log::error!("无法显示模拟器视图: {err}");
                        }
                    }
                })
                .auto_resize()
                .focused(false)
                .background_color(tauri::webview::Color(26, 26, 26, 255)),
                LogicalPosition::new(0.0, 0.0),
                size,
            )
            .map_err(|e| e.to_string())?;
        view.set_focus().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(mobile)]
    {
        let _ = app;
        Err("移动端使用独立页面入口".into())
    }
}

#[tauri::command]
pub async fn close_emulator(app: AppHandle, caller: Webview) -> Result<(), String> {
    if !["main", "emulator-nes", "emulator-arcade"].contains(&caller.label()) {
        return Err("无效的模拟器视图".into());
    }
    #[cfg(desktop)]
    {
        let state = app.state::<EmulatorViews>();
        let _guard = state.0.lock().map_err(|e| e.to_string())?;
        let main = app.get_webview("main").ok_or("主视图不存在")?;
        main.show().map_err(|e| e.to_string())?;
        for label in ["emulator-nes", "emulator-arcade"] {
            if let Some(view) = app.get_webview(label) {
                view.close().map_err(|e| e.to_string())?;
            }
        }
        main.set_focus().map_err(|e| e.to_string())?;
        app.emit_to("main", "emulator-closed", ())
            .map_err(|e| e.to_string())?;
    }
    #[cfg(mobile)]
    let _ = app;
    Ok(())
}
