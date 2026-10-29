// 应用内更新的 Android 实现：读取更新清单、下载 APK、唤起系统安装器。
// 安装依赖「安装未知应用」权限（REQUEST_INSTALL_PACKAGES），权限检测与安装
// 通过 JNI 调用 Updater.kt 完成；前端约定「无权限时不自检，先引导授权」。

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::updater::UpdateInfo;

pub(crate) const UPDATE_PROGRESS_EVENT: &str = "game-emulator://update-progress";
// 与 tauri.conf.json updater endpoints 保持同一份清单（updater release）。
// Android 更新项由 CI（release-app.yml 的 publish-android-manifest 任务）在发版时
// 写入 android 字段，客户端只读静态文件，不请求 GitHub API，避免匿名限流。
const UPDATER_MANIFEST_URL: &str =
    "https://github.com/while-coder/GameEmulator/releases/download/updater/latest.json";
const UPDATER_CLASS: &str = "com.wandergame.nesemulator.Updater";
/// 下载进度节流间隔，避免大文件下载把事件总线刷爆。
const PROGRESS_EMIT_INTERVAL: u64 = 256 * 1024;

#[derive(Debug, Deserialize)]
struct UpdaterManifest {
    android: Option<ManifestAndroidEntry>,
}

#[derive(Debug, Deserialize)]
struct ManifestAndroidEntry {
    version: String,
    notes: Option<String>,
    url: String,
}

// ---------------------------------------------------------------------------
// 权限与安装（JNI -> Updater.kt）
// ---------------------------------------------------------------------------

/// Use the current WebView's Activity and JNI environment. Unlike older Tao
/// versions, this project's runtime does not initialize ndk-context.
async fn with_jni_env<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(&mut jni::JNIEnv, &jni::objects::JObject, &jni::objects::JClass) -> Result<T, String>
        + Send
        + 'static,
) -> Result<T, String> {
    let webview = app.get_webview_window("main").ok_or("找不到主窗口")?;
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    webview
        .with_webview(move |webview| {
            webview.jni_handle().exec(move |env, context, _| {
                let result = (|| {
                    let loader = env
                        .call_method(context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
                        .and_then(|value| value.l())
                        .map_err(|error| error.to_string())?;
                    let name = env
                        .new_string(UPDATER_CLASS)
                        .map_err(|error| error.to_string())?;
                    let class = env
                        .call_method(
                            &loader,
                            "loadClass",
                            "(Ljava/lang/String;)Ljava/lang/Class;",
                            &[jni::objects::JValue::Object(&name)],
                        )
                        .and_then(|value| value.l())
                        .map_err(|error| error.to_string())?;
                    f(env, context, &jni::objects::JClass::from(class))
                })();
                if env.exception_check().unwrap_or(false) {
                    let _ = env.exception_clear();
                }
                let _ = sender.try_send(result);
            });
        })
        .map_err(|error| error.to_string())?;
    receiver.recv().await.ok_or("Android 更新调用已中断")?
}

pub(crate) async fn can_install_packages(app: &AppHandle) -> Result<bool, String> {
    with_jni_env(app, move |env, context, class| {
        env.call_static_method(
            class,
            "canInstallPackages",
            "(Landroid/content/Context;)Z",
            &[jni::objects::JValue::Object(context)],
        )
        .map_err(|error| format!("canInstallPackages 调用失败: {error}"))?
        .z()
        .map_err(|error| error.to_string())
    })
    .await
}

pub(crate) async fn request_install_permission(app: &AppHandle) -> Result<(), String> {
    with_jni_env(app, move |env, context, class| {
        env.call_static_method(
            class,
            "requestInstallPermission",
            "(Landroid/content/Context;)V",
            &[jni::objects::JValue::Object(context)],
        )
        .map_err(|error| format!("requestInstallPermission 调用失败: {error}"))?;
        Ok(())
    })
    .await
}

pub(crate) async fn install_apk(app: &AppHandle, path: String) -> Result<(), String> {
    with_jni_env(app, move |env, context, class| {
        let java_path = env.new_string(&path).map_err(|error| error.to_string())?;
        env.call_static_method(
            class,
            "installApk",
            "(Landroid/content/Context;Ljava/lang/String;)V",
            &[
                jni::objects::JValue::Object(context),
                jni::objects::JValue::Object(&java_path),
            ],
        )
        .map_err(|error| format!("installApk 调用失败: {error}"))?;
        Ok(())
    })
    .await
}

// ---------------------------------------------------------------------------
// 版本查询与下载
// ---------------------------------------------------------------------------

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("GameEmulator-Updater")
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())
}

/// 清单允许带 v 前缀；按语义版本比较，避免把旧版或相同版本当成更新。
fn is_newer_version(latest: &str, current: &str) -> bool {
    match (
        semver::Version::parse(latest),
        semver::Version::parse(current),
    ) {
        (Ok(latest), Ok(current)) => latest > current,
        _ => false,
    }
}

pub(crate) async fn check_update(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.to_string();
    let response = http_client()?
        .get(UPDATER_MANIFEST_URL)
        .send()
        .await
        .map_err(|error| format!("获取最新版本失败: {error}"))?
        .error_for_status()
        .map_err(|error| format!("获取最新版本失败: {error}"))?;
    let manifest: UpdaterManifest = response
        .json()
        .await
        .map_err(|error| format!("解析最新版本信息失败: {error}"))?;
    // 清单还没有 android 字段（旧版 CI 产物）时视为无更新。
    let Some(entry) = manifest.android else {
        return Ok(None);
    };
    let latest = entry.version.trim().trim_start_matches('v').trim();
    if latest.is_empty() || !is_newer_version(latest, &current) {
        return Ok(None);
    }
    Ok(Some(UpdateInfo {
        version: latest.to_string(),
        notes: entry.notes.unwrap_or_default().trim().to_string(),
        url: entry.url,
    }))
}

pub(crate) async fn download_update(
    app: &AppHandle,
    url: String,
    version: String,
) -> Result<String, String> {
    if !url.starts_with("https://github.com/while-coder/GameEmulator/releases/download/")
        || !url.ends_with(".apk")
    {
        return Err("更新包地址不属于本应用的 GitHub Release".to_string());
    }
    semver::Version::parse(&version).map_err(|error| error.to_string())?;
    let client = http_client()?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("下载更新失败: {error}"))?
        .error_for_status()
        .map_err(|error| format!("下载更新失败: {error}"))?;
    let total = response.content_length();

    // 下载先写入临时文件，完成后才作为 APK 提供给安装器。
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("updates");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let destination = directory.join("update.apk");
    let partial = directory.join("update.apk.part");

    let mut file = std::fs::File::create(&partial).map_err(|error| error.to_string())?;
    let mut downloaded: u64 = 0;
    let mut emitted: u64 = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("下载更新失败: {error}"))?
    {
        std::io::Write::write_all(&mut file, &chunk).map_err(|error| error.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded - emitted >= PROGRESS_EMIT_INTERVAL {
            emitted = downloaded;
            app.emit(
                UPDATE_PROGRESS_EVENT,
                UpdateProgressPayload { downloaded, total },
            )
            .map_err(|error| error.to_string())?;
        }
    }
    if downloaded == 0 || total.is_some_and(|total| downloaded != total) {
        return Err("更新包下载不完整，请重试".to_string());
    }
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    std::fs::rename(&partial, &destination).map_err(|error| error.to_string())?;
    app.emit(
        UPDATE_PROGRESS_EVENT,
        UpdateProgressPayload { downloaded, total },
    )
    .map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[derive(Clone, serde::Serialize)]
struct UpdateProgressPayload {
    downloaded: u64,
    total: Option<u64>,
}
