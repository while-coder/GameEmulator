use tauri::{AppHandle, Webview};

#[cfg(desktop)]
use tauri::{webview::PageLoadEvent, Emitter, LogicalPosition, Manager, WebviewBuilder, WebviewUrl};

// Serializes creation/closure. Never create native webviews in a synchronous
// command: WebView2 creation must be allowed to dispatch to the main thread.
#[derive(Default)]
pub struct EmulatorViews(#[cfg(desktop)] pub std::sync::Mutex<()>);

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EmulatorEntry {
    Play { key: String, name: String, #[serde(rename = "saveKey")] save_key: Option<String> },
    Settings,
}

#[cfg(desktop)]
fn child_url(id: &str, entry: EmulatorEntry) -> Result<WebviewUrl, String> {
    let mut url = tauri::Url::parse("http://localhost/").map_err(|e| e.to_string())?;
    let mut query = url.query_pairs_mut();
    query.append_pair("child", "1");
    match entry {
        EmulatorEntry::Play { key, name, save_key } => {
            if key.len() != 64 || !key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err("无效的游戏标识".into());
            }
            query.append_pair("game", &key);
            query.append_pair("name", &name.chars().take(180).collect::<String>());
            if let Some(save) = save_key {
                if save.is_empty() || save.len() > 8192 {
                    return Err("无效的存档标识".into());
                }
                query.append_pair("save", &save);
            }
        }
        EmulatorEntry::Settings => { query.append_pair("view", "settings"); }
    }
    drop(query);
    Ok(WebviewUrl::App(format!("{id}.html?{}", url.query().unwrap_or_default()).into()))
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;

    #[test]
    fn desktop_child_receives_the_selected_arcade_save() {
        let key = "a".repeat(64);
        let save = format!("fbalpha2012:{key}:parent.zip=abcd,bios.zip=ef01:s-123");
        let entry = serde_json::from_value(serde_json::json!({
            "kind": "play",
            "key": key,
            "name": "恐龙新世纪 (930201 etc)",
            "saveKey": save,
        }))
        .unwrap();
        let WebviewUrl::App(path) = child_url("arcade", entry).unwrap() else {
            panic!("expected a local player page");
        };
        let url = tauri::Url::parse("http://localhost:1801/")
            .unwrap()
            .join(path.to_str().unwrap())
            .unwrap();
        let query: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(url.path(), "/arcade.html");
        assert_eq!(query["child"], "1");
        assert_eq!(query["game"], key);
        assert_eq!(query["save"], save);
    }
}

#[tauri::command]
pub async fn open_emulator_with_entry(app: AppHandle, caller: Webview, id: String, entry: EmulatorEntry) -> Result<(), String> {
    if caller.label() != "main" || !["nes", "arcade", "gba", "sfc", "psp"].contains(&id.as_str()) {
        return Err("不支持的模拟器入口".into());
    }
    #[cfg(desktop)]
    {
        let url = child_url(&id, entry)?;
        let state = app.state::<EmulatorViews>();
        let _guard = state.0.lock().map_err(|e| e.to_string())?;
        if ["emulator-nes", "emulator-arcade", "emulator-gba", "emulator-sfc", "emulator-psp"]
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
                    url,
                )
                .on_web_resource_request(|request, response| {
                    let path = request.uri().path();
                    if path.ends_with("/psp.html") || path.contains("/PPSSPPSDL") {
                        let headers = response.headers_mut();
                        headers.insert("Cross-Origin-Opener-Policy", tauri::http::HeaderValue::from_static("same-origin"));
                        headers.insert("Cross-Origin-Embedder-Policy", tauri::http::HeaderValue::from_static("require-corp"));
                    }
                })
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
        let _ = (app, entry);
        Err("移动端使用独立页面入口".into())
    }
}

#[tauri::command]
pub async fn close_emulator(app: AppHandle, caller: Webview) -> Result<(), String> {
    if !["main", "emulator-nes", "emulator-arcade", "emulator-gba", "emulator-sfc", "emulator-psp"].contains(&caller.label()) {
        return Err("无效的模拟器视图".into());
    }
    #[cfg(desktop)]
    {
        let state = app.state::<EmulatorViews>();
        let _guard = state.0.lock().map_err(|e| e.to_string())?;
        let main = app.get_webview("main").ok_or("主视图不存在")?;
        main.window().set_fullscreen(false).map_err(|e| e.to_string())?;
        main.show().map_err(|e| e.to_string())?;
        for label in ["emulator-nes", "emulator-arcade", "emulator-gba", "emulator-sfc", "emulator-psp"] {
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
