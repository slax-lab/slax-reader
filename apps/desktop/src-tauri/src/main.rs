#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands;
mod credentials;
mod menu;
mod native;
mod updates;
use futures_util::{FutureExt, StreamExt, pin_mut};
use slax_core::{dto::CoreError, runtime::Runtime};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
struct Shell {
    core: Arc<Runtime>,
    selection: Mutex<Option<(String, String)>>,
    nonce: String,
    shutting_down: AtomicBool,
    reader_menu: Mutex<Option<menu::ReaderMenuContext>>,
    capture_url: Mutex<Option<String>>,
}
enum Prompt {
    OpenBrowser,
    ImportPdf,
    InstallUpdate,
}
async fn confirm(core: &Runtime, prompt: Prompt, message: &str) -> bool {
    let zh = core.preferences.read().unwrap().language == "zh";
    let title = match (prompt, zh) {
        (Prompt::OpenBrowser, false) => "Open in your browser?",
        (Prompt::OpenBrowser, true) => "在浏览器中打开？",
        (Prompt::ImportPdf, false) => "Import PDF?",
        (Prompt::ImportPdf, true) => "导入 PDF？",
        (Prompt::InstallUpdate, false) => "Install update?",
        (Prompt::InstallUpdate, true) => "安装更新？",
    };
    let accept = if zh { "继续" } else { "Continue" };
    let cancel = if zh { "取消" } else { "Cancel" };
    rfd::AsyncMessageDialog::new()
        .set_title(title)
        .set_description(message)
        .set_buttons(rfd::MessageButtons::OkCancelCustom(
            accept.into(),
            cancel.into(),
        ))
        .show()
        .await
        == rfd::MessageDialogResult::Custom(accept.into())
}
fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        let _ = w.emit("window-restored", ());
        app.state::<Shell>().core.notify();
    }
}
fn callback(app: &tauri::AppHandle, url: String) {
    if let Ok(u) = url::Url::parse(&url)
        && u.scheme() == app.state::<Shell>().core.build.callback_scheme
        && u.host_str() == Some("add")
        && u.path().is_empty()
        && u.fragment().is_none()
        && u.username().is_empty()
        && u.password().is_none()
    {
        let pairs: Vec<_> = u.query_pairs().collect();
        if pairs.len() == 1
            && pairs[0].0 == "url"
            && let Ok(target) = slax_core::repository::external_url(&pairs[0].1)
        {
            show(app);
            *app.state::<Shell>().capture_url.lock().unwrap() = Some(target.to_string());
            let _ = app.emit("capture-url", ());
        }
        return;
    }
    let core = app.state::<Shell>().core.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = async {
            core.restore().await?;
            core.login_callback(&url).await
        }
        .await;
        match result {
            Ok(state) => {
                let _ = app.emit("auth-state", state);
                show(&app)
            }
            Err(error) => {
                let _ = app.emit("core-error", error);
            }
        }
    });
}
fn main() {
    let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
        commands::auth_state,
        commands::auth_begin,
        commands::auth_cancel,
        commands::auth_pending_writes,
        commands::auth_sign_out,
        commands::library_snapshot,
        commands::library_search,
        commands::library_original,
        commands::library_watch,
        commands::library_unwatch,
        commands::library_add,
        commands::library_mutate,
        commands::library_tag_create,
        commands::library_select,
        menu::library_context,
        commands::reader_open,
        commands::reader_close,
        commands::reader_marks,
        commands::reader_marks_watch,
        commands::reader_marks_unwatch,
        commands::reader_mark_add,
        commands::reader_mark_delete,
        commands::reader_progress,
        commands::reader_copy,
        commands::reader_external,
        commands::pdf_range,
        commands::settings_get,
        commands::settings_build,
        commands::settings_save,
        commands::settings_system,
        commands::settings_product,
        commands::settings_browser,
        commands::library_clipboard,
        commands::library_capture,
        commands::ai_stream,
        commands::reader_share,
        commands::reader_images,
        commands::reader_download,
        commands::rss_open,
        commands::settings_clear_cache,
        commands::settings_subscription,
        commands::settings_event,
        commands::pdf_import,
        commands::pdf_progress,
        menu::reader_context,
        updates::settings_update_check,
        updates::settings_update_install
    ];
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            show(app);
            for arg in args {
                if url::Url::parse(&arg).is_ok_and(|url| url.scheme() == app.state::<Shell>().core.build.callback_scheme) {
                    callback(app, arg);
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("slaxframe", |context, request, responder| {
            resource(context.app_handle().clone(), request.uri().to_string(), responder);
        })
        .register_asynchronous_uri_scheme_protocol("slaximg", |context, request, responder| {
            resource(context.app_handle().clone(), request.uri().to_string(), responder);
        })
        .invoke_handler(move |invoke| {
            let allowed = {
                let webview = invoke.message.webview();
                let shell = webview.state::<Shell>();
                let nonce = invoke.message.headers().get("x-slax-main").and_then(|v| v.to_str().ok());
                let local = webview.url().is_ok_and(|url| {
                    url.scheme() == "tauri" && url.host_str() == Some("localhost")
                        || cfg!(debug_assertions) && url.as_str().starts_with("http://127.0.0.1:1420/")
                });
                webview.label() == "main" && local && nonce == Some(shell.nonce.as_str())
            };
            if allowed {
                handler(invoke)
            } else {
                invoke.resolver.reject(CoreError::new("IPC_DENIED"));
                true
            }
        })
        .setup(|app| {
            let nonce = slax_core::auth::opaque();
            let profile: slax_core::dto::BuildInfo = serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/desktop-environment.json")))?;
            if app.config().identifier != profile.identifier {
                return Err(CoreError::new("BUILD_ENVIRONMENT_MISMATCH").into());
            }
            let origin_scope = slax_core::auth::challenge(&format!("{}\n{}", profile.api_origin.trim_end_matches('/'), profile.web_origin.trim_end_matches('/')));
            let root = app.path().app_data_dir()?.join("environments").join(origin_scope);
            let credentials = Arc::new(credentials::LocalCredentials { directory: root.join("credentials") });
            let core = Arc::new(Runtime::new(profile, root, credentials)?);
            app.manage(Shell {
                core: core.clone(),
                selection: Mutex::new(None),
                nonce: nonce.clone(),
                shutting_down: AtomicBool::new(false),
                reader_menu: Mutex::new(None),
                capture_url: Mutex::new(None),
            });
            let initialization = format!(
                "if(window===window.top)Object.defineProperty(window,'__SLAX_IPC_CAPABILITY__',{{value:{}}});",
                serde_json::to_string(&nonce)?
            );
            let window = tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .initialization_script(initialization)
                .on_navigation(|url| {
                    url.scheme() == "tauri" || url.scheme() == "slaxframe"
                        || cfg!(debug_assertions) && url.as_str().starts_with("http://127.0.0.1:1420/")
                })
                .build()?;
            window.set_title(&core.build.product_name)?;
            window_vibrancy::apply_vibrancy(
                &window,
                window_vibrancy::NSVisualEffectMaterial::Sidebar,
                Some(window_vibrancy::NSVisualEffectState::FollowsWindowActiveState),
                None,
            )?;
            menu::install(app.handle(), core.preferences.read().unwrap().language == "zh")?;
            app.on_menu_event(|app, event| menu::dispatch(app, event.id().as_ref()));
            core.system.write().unwrap().dark = window.theme().ok() == Some(tauri::Theme::Dark);
            install_tray(app)?;
            app.deep_link().on_open_url({
                let app = app.handle().clone();
                move |event| {
                    for url in event.urls() {
                        callback(&app, url.to_string());
                    }
                }
            });
            if let Some(urls) = app.deep_link().get_current()? {
                for url in urls {
                    callback(app.handle(), url.to_string());
                }
            }
            native::install(app.handle().clone(), core);
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                import_dropped_pdfs(window.app_handle().clone(), paths.clone());
            }
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::Focused(true) => {
                window.state::<Shell>().core.notify();
            }
            tauri::WindowEvent::ThemeChanged(theme) => {
                let shell = window.state::<Shell>();
                let mut state = shell.core.system.write().unwrap();
                state.dark = *theme == tauri::Theme::Dark;
                let _ = window.emit("system-state", state.clone());
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("Could not initialize Slax Reader");
    app.run(|app, event| match event {
        tauri::RunEvent::Reopen { .. } => show(app),
        tauri::RunEvent::ExitRequested { api, .. } => {
            if app
                .state::<Shell>()
                .shutting_down
                .swap(true, Ordering::SeqCst)
            {
                return;
            }
            native::shutdown();
            let core = app.state::<Shell>().core.clone();
            api.prevent_exit();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                core.shutdown().await;
                app.exit(0);
            });
        }
        _ => {}
    });
}
fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    let zh = app
        .state::<Shell>()
        .core
        .preferences
        .read()
        .unwrap()
        .language
        == "zh";
    let show_item = tauri::menu::MenuItem::with_id(
        app,
        "tray_show",
        if zh {
            "显示 Slax Reader"
        } else {
            "Show Slax Reader"
        },
        true,
        None::<&str>,
    )?;
    let add_item = tauri::menu::MenuItem::with_id(
        app,
        "tray_add",
        if zh {
            "保存链接…"
        } else {
            "Save Link…"
        },
        true,
        None::<&str>,
    )?;
    let menu = tauri::menu::Menu::with_items(app, &[&show_item, &add_item])?;
    tauri::tray::TrayIconBuilder::with_id("slax-status")
        .title("Slax")
        .tooltip("Slax Reader")
        .menu(&menu)
        .on_menu_event(|app, event| {
            show(app);
            if event.id().as_ref() == "tray_add" {
                let _ = app.emit("menu-intent", "add");
            }
        })
        .build(app)?;
    let app = app.handle().clone();
    let core = app.state::<Shell>().core.clone();
    tauri::async_runtime::spawn(async move {
        let mut events = core.events.subscribe();
        let mut shown: Option<(&'static str, String)> = None;
        let mut publish = |value: (&'static str, String)| {
            if shown.as_ref() != Some(&value) {
                if let Some(tray) = app.tray_by_id("slax-status") {
                    let _ = tray.set_title(Some(value.0));
                    let _ = tray.set_tooltip(Some(format!("Slax Reader — {}", value.1)));
                }
                shown = Some(value);
            }
        };
        loop {
            let account = core.active().await.ok();
            publish(tray_status(&core, account.as_deref()).await);
            let Some(account) = account else {
                tokio::select! {
                    _ = core.lifetime.cancelled() => break,
                    v = events.changed() => if v.is_err() { break },
                }
                continue;
            };
            let status = account.db.watch_status();
            let crud = account.db.watch_tables(false, ["ps_crud"]);
            pin_mut!(status, crud);
            loop {
                let expiry = {
                    let expires = account.session.lock().await.expires_at;
                    let now = slax_core::auth::now();
                    std::time::Duration::from_secs(if expires > now {
                        expires - now + 1
                    } else {
                        24 * 3600
                    })
                };
                let rebuild = tokio::select! {
                    _ = core.lifetime.cancelled() => return,
                    _ = account.cancel.cancelled() => true,
                    v = events.changed() => { if v.is_err() { return } false }
                    v = status.next() => v.is_none(),
                    v = crud.next() => v.is_none(),
                    _ = tokio::time::sleep(expiry) => false,
                };
                if rebuild || !core.active().await.is_ok_and(|a| Arc::ptr_eq(&a, &account)) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                while let Some(Some(_)) = status.next().now_or_never() {}
                while let Some(Some(())) = crud.next().now_or_never() {}
                publish(tray_status(&core, Some(&account)).await);
            }
        }
    });
    Ok(())
}
async fn tray_status(
    core: &Runtime,
    account: Option<&slax_core::account::Account>,
) -> (&'static str, String) {
    let zh = core.preferences.read().unwrap().language == "zh";
    let system = core.system.read().unwrap().clone();
    let pick = |en: &str, cn: &str| if zh { cn.to_string() } else { en.to_string() };
    let Some(account) = account else {
        return ("Slax", pick("Sign in to Slax Reader", "请登录"));
    };
    let sync = account.db.status();
    let pending = account.pending().await.unwrap_or(0);
    if !system.online || system.sleeping {
        (
            "Slax ⏸",
            pick("Offline — changes kept on this Mac", "离线，更改保存在本机"),
        )
    } else if account.session.lock().await.expires_at <= slax_core::auth::now() {
        ("Slax !", pick("Please sign in again", "请重新登录"))
    } else if sync.any_error().is_some() {
        ("Slax !", pick("Sync paused", "同步已暂停"))
    } else if pending > 0 {
        (
            "Slax •",
            if zh {
                format!("{pending} 项更改等待同步")
            } else {
                format!("{pending} changes waiting to sync")
            },
        )
    } else if sync.is_downloading() || sync.is_uploading() || !sync.has_synced() {
        ("Slax ↻", pick("Syncing…", "同步中…"))
    } else {
        ("Slax", pick("Up to date", "已同步"))
    }
}
fn import_dropped_pdfs(app: tauri::AppHandle, paths: Vec<std::path::PathBuf>) {
    tauri::async_runtime::spawn(async move {
        let core = app.state::<Shell>().core.clone();
        let Ok(account) = core.active().await else {
            return;
        };
        let generation = account.generation.clone();
        for path in paths.into_iter().take(10) {
            if !path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
            {
                continue;
            }
            let name = path.file_name().and_then(|v| v.to_str()).unwrap_or("PDF");
            if !confirm(&core, Prompt::ImportPdf, name).await {
                continue;
            }
            match core.import_pdf(&generation, &path).await {
                Ok(id) => {
                    let _ = app.emit("pdf-imported", id);
                }
                Err(error) => {
                    let _ = app.emit("core-error", error);
                }
            }
        }
    });
}

fn resource(app: tauri::AppHandle, uri: String, responder: tauri::UriSchemeResponder) {
    let core = app.state::<Shell>().core.clone();
    tauri::async_runtime::spawn(async move {
        let response = match core.resource(&uri).await {
            Ok(resource) => tauri::http::Response::builder()
                .header("Content-Type", resource.mime)
                .header("Cache-Control", "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .header("Referrer-Policy", "no-referrer")
                .body(resource.bytes),
            Err(_) => tauri::http::Response::builder()
                .status(403)
                .header("Cache-Control", "no-store")
                .body(Vec::new()),
        };
        if let Ok(response) = response {
            responder.respond(response)
        }
    });
}
