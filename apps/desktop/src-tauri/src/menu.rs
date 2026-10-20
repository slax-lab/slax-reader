use crate::Shell;
use slax_core::dto::BookmarkAction;
use tauri::{
    Emitter, Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
};
pub fn install(app: &tauri::AppHandle, zh: bool) -> tauri::Result<()> {
    let label = |en, cn| if zh { cn } else { en };
    let settings = MenuItem::with_id(
        app,
        "settings",
        label("Settings…", "设置…"),
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let app_menu = Submenu::with_items(
        app,
        "Slax Reader",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        label("Edit", "编辑"),
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let inbox = MenuItem::with_id(
        app,
        "inbox",
        label("Inbox", "收件箱"),
        true,
        Some("CmdOrCtrl+1"),
    )?;
    let starred = MenuItem::with_id(
        app,
        "starred",
        label("Starred", "星标"),
        true,
        Some("CmdOrCtrl+2"),
    )?;
    let archived = MenuItem::with_id(
        app,
        "archived",
        label("Archive", "归档"),
        true,
        Some("CmdOrCtrl+3"),
    )?;
    let sidebar = MenuItem::with_id(
        app,
        "sidebar",
        label("Toggle Sidebar", "显示或隐藏侧边栏"),
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let add = MenuItem::with_id(
        app,
        "add",
        label("Save Link…", "保存链接…"),
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let import = MenuItem::with_id(
        app,
        "import_pdf",
        label("Import PDF…", "导入 PDF…"),
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let view = Submenu::with_items(
        app,
        label("View", "显示"),
        true,
        &[&inbox, &starred, &archived, &sidebar, &add, &import],
    )?;
    let star = MenuItem::with_id(
        app,
        "article_star",
        label("Toggle Star", "切换星标"),
        false,
        Some("CmdOrCtrl+Shift+F"),
    )?;
    let archive = MenuItem::with_id(
        app,
        "article_archive",
        label("Toggle Archive", "切换归档"),
        false,
        Some("CmdOrCtrl+E"),
    )?;
    let original = MenuItem::with_id(
        app,
        "article_original",
        label("Open Original…", "打开原文…"),
        false,
        Some("CmdOrCtrl+Shift+O"),
    )?;
    let article = Submenu::with_items(
        app,
        label("Article", "文章"),
        true,
        &[&star, &archive, &original],
    )?;
    app.set_menu(Menu::with_items(app, &[&app_menu, &edit, &view, &article])?)?;
    Ok(())
}
pub fn set_selection(app: &tauri::AppHandle, enabled: bool) {
    if let Some(menu) = app.menu() {
        for id in ["article_star", "article_archive", "article_original"] {
            if let Some(item) = menu.get(id).and_then(|i| i.as_menuitem().cloned()) {
                let _ = item.set_enabled(enabled);
            }
        }
    }
}
pub fn set_mutation_enabled(app: &tauri::AppHandle, enabled: bool) {
    if let Some(menu) = app.menu() {
        for id in ["article_star", "article_archive"] {
            if let Some(item) = menu.get(id).and_then(|i| i.as_menuitem().cloned()) {
                let _ = item.set_enabled(enabled);
            }
        }
    }
}
pub fn dispatch(app: &tauri::AppHandle, id: &str) {
    if id.starts_with("reader_") {
        reader_dispatch(app, id);
        return;
    }
    if !id.starts_with("article_") {
        let _ = app.emit("menu-intent", id);
        return;
    }
    let selected = app.state::<Shell>().selection.lock().unwrap().clone();
    let Some((generation, id_bookmark)) = selected else {
        return;
    };
    let app = app.clone();
    let command = id.to_owned();
    tauri::async_runtime::spawn(async move {
        let core = app.state::<Shell>().core.clone();
        let work = async {
            let a = core.account(&generation).await?;
            let _lease = a.lease.read().await;
            let bookmark = a.bookmark(&id_bookmark).await?;
            match command.as_str() {
                "article_star" => {
                    a.mutate(&id_bookmark, BookmarkAction::Star(!bookmark.starred))
                        .await?
                }
                "article_archive" => {
                    a.mutate(&id_bookmark, BookmarkAction::Archive(!bookmark.archived))
                        .await?
                }
                "article_original" => {
                    let url = slax_core::repository::external_url(&bookmark.url)?;
                    if crate::confirm(&core, crate::Prompt::OpenBrowser, url.as_str()).await {
                        a.check()?;
                        open::that_detached(url.as_str())
                            .map_err(|_| slax_core::dto::CoreError::new("BROWSER_UNAVAILABLE"))?;
                    }
                }
                _ => {}
            }
            Ok::<_, slax_core::dto::CoreError>(())
        }
        .await;
        if let Err(error) = work {
            let _ = app.emit("core-error", error);
        }
    });
}
#[tauri::command]
pub async fn library_context(
    shell: tauri::State<'_, Shell>,
    window: tauri::WebviewWindow,
    generation: String,
    id: String,
) -> slax_core::dto::Result<()> {
    let a = shell.core.account(&generation).await?;
    let _lease = a.lease.read().await;
    let bookmark = a.bookmark(&id).await?;
    *shell.selection.lock().unwrap() = Some((generation, id));
    let zh = shell.core.preferences.read().unwrap().language == "zh";
    let menu = Menu::with_items(
        &window,
        &[
            &MenuItem::with_id(
                &window,
                "article_star",
                if zh { "切换星标" } else { "Toggle Star" },
                true,
                None::<&str>,
            )
            .map_err(|_| slax_core::dto::CoreError::new("MENU_UNAVAILABLE"))?,
            &MenuItem::with_id(
                &window,
                "article_archive",
                if zh { "切换归档" } else { "Toggle Archive" },
                true,
                None::<&str>,
            )
            .map_err(|_| slax_core::dto::CoreError::new("MENU_UNAVAILABLE"))?,
            &MenuItem::with_id(
                &window,
                "article_original",
                if zh {
                    "打开原文…"
                } else {
                    "Open Original…"
                },
                !bookmark.url.is_empty(),
                None::<&str>,
            )
            .map_err(|_| slax_core::dto::CoreError::new("MENU_UNAVAILABLE"))?,
        ],
    )
    .map_err(|_| slax_core::dto::CoreError::new("MENU_UNAVAILABLE"))?;
    window
        .popup_menu(&menu)
        .map_err(|_| slax_core::dto::CoreError::new("MENU_UNAVAILABLE"))
}
pub struct ReaderMenuContext {
    pub generation: String,
    pub handle: String,
    pub selection: Option<slax_core::dto::Selection>,
    pub url: Option<String>,
}
#[tauri::command]
pub async fn reader_context(
    shell: tauri::State<'_, Shell>,
    window: tauri::WebviewWindow,
    generation: String,
    handle: String,
    selection: Option<slax_core::dto::Selection>,
    url: Option<String>,
) -> slax_core::dto::Result<()> {
    let (a, id) = shell.core.document_account(&generation, &handle).await?;
    let _lease = a.lease.read().await;
    let can_mark = a.bookmark(&id).await.is_ok();
    let has_selection = selection
        .as_ref()
        .is_some_and(|s| !s.text.is_empty() && s.text.len() <= 100000);
    let url = url.and_then(|v| {
        slax_core::repository::external_url(&v)
            .ok()
            .map(|u| u.to_string())
    });
    let has_url = url.is_some();
    let zh = shell.core.preferences.read().unwrap().language == "zh";
    *shell.reader_menu.lock().unwrap() = Some(ReaderMenuContext {
        generation,
        handle,
        selection,
        url,
    });
    let item = |id, en, cn, enabled| {
        MenuItem::with_id(&window, id, if zh { cn } else { en }, enabled, None::<&str>)
    };
    let menu = (|| -> tauri::Result<_> {
        Menu::with_items(
            &window,
            &[
                &item(
                    "reader_highlight",
                    "Highlight",
                    "划线",
                    has_selection && can_mark,
                )?,
                &item(
                    "reader_comment",
                    "Comment",
                    "评论",
                    has_selection && can_mark,
                )?,
                &item("reader_copy", "Copy", "复制", has_selection)?,
                &item(
                    "reader_link",
                    "Open in Browser…",
                    "在浏览器中打开…",
                    has_url,
                )?,
            ],
        )
    })()
    .map_err(|_| slax_core::dto::CoreError::new("MENU_UNAVAILABLE"))?;
    window
        .popup_menu(&menu)
        .map_err(|_| slax_core::dto::CoreError::new("MENU_UNAVAILABLE"))
}
fn reader_dispatch(app: &tauri::AppHandle, command: &str) {
    let context = app.state::<Shell>().reader_menu.lock().unwrap().take();
    let Some(context) = context else { return };
    let app = app.clone();
    let command = command.to_string();
    tauri::async_runtime::spawn(async move {
        let core = app.state::<Shell>().core.clone();
        let result = async {
            let (a, id) = core
                .document_account(&context.generation, &context.handle)
                .await?;
            let _lease = a.lease.read().await;
            match command.as_str() {
                "reader_highlight" => {
                    a.add_mark(&id, 1, context.selection, "", None).await?;
                }
                "reader_comment" => {
                    a.bookmark(&id).await?;
                    let _ = app.emit(
                        "reader-menu",
                        serde_json::json!({"handle":context.handle,"operation":"comment"}),
                    );
                }
                "reader_copy" => {
                    let text = context
                        .selection
                        .ok_or_else(|| slax_core::dto::CoreError::new("SELECTION_REQUIRED"))?
                        .text;
                    arboard::Clipboard::new()
                        .and_then(|mut c| c.set_text(text))
                        .map_err(|_| slax_core::dto::CoreError::new("CLIPBOARD_UNAVAILABLE"))?;
                }
                "reader_link" => {
                    let url = context
                        .url
                        .ok_or_else(|| slax_core::dto::CoreError::new("INVALID_URL"))?;
                    if crate::confirm(&core, crate::Prompt::OpenBrowser, &url).await {
                        a.document_id(&context.handle)?;
                        open::that_detached(url)
                            .map_err(|_| slax_core::dto::CoreError::new("BROWSER_UNAVAILABLE"))?;
                    }
                }
                _ => {}
            }
            Ok::<_, slax_core::dto::CoreError>(())
        }
        .await;
        if let Err(error) = result {
            let _ = app.emit("core-error", error);
        }
    });
}
