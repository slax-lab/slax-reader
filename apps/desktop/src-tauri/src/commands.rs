use crate::Shell;
use futures_util::{FutureExt, StreamExt, pin_mut};
use serde_json::{Value, json};
use slax_core::dto::*;
use std::time::Duration;
use tauri::{
    State, WebviewWindow,
    ipc::{Channel, Response},
};
use tokio_util::sync::CancellationToken;
#[tauri::command]
pub async fn auth_state(shell: State<'_, Shell>) -> Result<AuthState> {
    shell.core.restore().await
}
#[tauri::command]
pub async fn auth_begin(shell: State<'_, Shell>) -> Result<()> {
    let url = shell.core.login_begin().await?;
    open::that_detached(url.as_str()).map_err(|_| CoreError::new("BROWSER_UNAVAILABLE"))
}
#[tauri::command]
pub async fn auth_cancel(shell: State<'_, Shell>) -> Result<()> {
    shell.core.login_cancel().await
}
#[tauri::command]
pub async fn auth_pending_writes(shell: State<'_, Shell>, generation: String) -> Result<u32> {
    shell.core.account(&generation).await?.pending().await
}
#[tauri::command]
pub async fn auth_sign_out(
    shell: State<'_, Shell>,
    generation: String,
    discard: bool,
) -> Result<()> {
    shell.core.logout(&generation, discard).await?;
    *shell.selection.lock().unwrap() = None;
    Ok(())
}
#[tauri::command]
pub async fn library_snapshot(
    shell: State<'_, Shell>,
    generation: String,
    view: String,
    tags: Vec<String>,
) -> Result<LibrarySnapshot> {
    shell.core.snapshot(&generation, &view, &tags).await
}
#[tauri::command]
pub async fn library_watch(
    shell: State<'_, Shell>,
    window: WebviewWindow,
    generation: String,
    view: String,
    tags: Vec<String>,
    channel: Channel<LibraryUpdate>,
) -> Result<String> {
    slax_core::repository::tag_values(&tags)?;
    let core = shell.core.clone();
    let a = core.account(&generation).await?;
    let id = slax_core::auth::opaque();
    let cancel = CancellationToken::new();
    core.watches.lock().await.insert(id.clone(), cancel.clone());
    let watch = id.clone();
    tauri::async_runtime::spawn(async move {
        let data = a.db.watch_tables(false, LIBRARY_TABLES);
        let crud = a.db.watch_tables(false, ["ps_crud"]);
        let status = a.db.watch_status();
        let mut events = core.events.subscribe();
        pin_mut!(data, crud, status);
        let mut last: Option<LibrarySnapshot> = None;
        let (mut data_dirty, mut sync_dirty) = (true, true);
        let mut revision = 0u32;
        loop {
            if cancel.is_cancelled() || a.cancel.is_cancelled() {
                break;
            }
            if (data_dirty || sync_dirty) && window.is_visible().unwrap_or(false) {
                let update = if data_dirty || last.is_none() {
                    let Ok(mut value) = core.snapshot(&generation, &view, &tags).await else {
                        break;
                    };
                    let changed = last.as_ref().is_none_or(|old| {
                        old.bookmarks != value.bookmarks
                            || old.tags != value.tags
                            || old.collections != value.collections
                    });
                    let sync_changed = last.as_ref().map(|v| &v.sync) != Some(&value.sync);
                    if changed {
                        revision = revision.wrapping_add(1);
                    }
                    value.revision = revision;
                    let update = if changed {
                        Some(LibraryUpdate::Snapshot(value.clone()))
                    } else if sync_changed {
                        Some(LibraryUpdate::Sync(value.sync.clone()))
                    } else {
                        None
                    };
                    last = Some(value);
                    update
                } else {
                    let Ok(sync) = core.sync_state(&a).await else {
                        break;
                    };
                    match last.as_mut() {
                        Some(old) if old.sync != sync => {
                            old.sync = sync.clone();
                            Some(LibraryUpdate::Sync(sync))
                        }
                        _ => None,
                    }
                };
                data_dirty = false;
                sync_dirty = false;
                if let Some(update) = update
                    && channel.send(update).is_err()
                {
                    break;
                }
            }
            let expiry = {
                let expires = a.session.lock().await.expires_at;
                let now = slax_core::auth::now();
                Duration::from_secs(if expires > now {
                    expires - now + 1
                } else {
                    24 * 3600
                })
            };
            let downloading = a.db.status().is_downloading();
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = a.cancel.cancelled() => break,
                v = data.next() => { if v.is_none() { break } data_dirty = true; }
                v = crud.next() => { if v.is_none() { break } sync_dirty = true; }
                v = status.next() => { if v.is_none() { break } sync_dirty = true; }
                v = events.changed() => { if v.is_err() { break } sync_dirty = true; }
                _ = tokio::time::sleep(expiry) => { sync_dirty = true; }
            }
            let settle = Duration::from_millis(if downloading { 400 } else { 150 });
            tokio::select! {_=cancel.cancelled()=>break,_=tokio::time::sleep(settle)=>{}}
            while let Some(Some(())) = data.next().now_or_never() {
                data_dirty = true;
            }
            while let Some(Some(())) = crud.next().now_or_never() {
                sync_dirty = true;
            }
            while let Some(Some(_)) = status.next().now_or_never() {
                sync_dirty = true;
            }
        }
        core.watches.lock().await.remove(&watch);
    });
    Ok(id)
}
const LIBRARY_TABLES: [&str; 7] = [
    "sr_user_bookmark",
    "local_bookmark_info",
    "sr_user_tag",
    "sr_collection_bookmark",
    "sr_sharer_setting",
    "sr_user_collection",
    "sr_user_collection_subscriber",
];
#[tauri::command]
pub async fn library_unwatch(shell: State<'_, Shell>, watch_id: String) -> Result<()> {
    shell.core.cancel(&watch_id).await;
    Ok(())
}
#[tauri::command]
pub async fn library_add(
    shell: State<'_, Shell>,
    generation: String,
    url: String,
) -> Result<String> {
    shell.core.add_url(&generation, &url).await
}
#[tauri::command]
pub async fn library_mutate(
    shell: State<'_, Shell>,
    generation: String,
    id: String,
    action: BookmarkAction,
) -> Result<()> {
    shell.core.mutate(&generation, &id, action).await
}
#[tauri::command]
pub async fn library_tag_create(
    shell: State<'_, Shell>,
    generation: String,
    name: String,
) -> Result<String> {
    let a = shell.core.account(&generation).await?;
    let _lease = a.lease.read().await;
    a.create_tag(&name).await
}
#[tauri::command]
pub async fn library_select(
    shell: State<'_, Shell>,
    app: tauri::AppHandle,
    generation: String,
    id: Option<String>,
) -> Result<()> {
    let mut mutable = true;
    let selected = if let Some(id) = id {
        let a = shell.core.account(&generation).await?;
        let _lease = a.lease.read().await;
        mutable = a.bookmark(&id).await?.owner_id.is_none();
        Some((generation, id))
    } else {
        None
    };
    crate::menu::set_selection(&app, selected.is_some());
    crate::menu::set_mutation_enabled(&app, selected.is_some() && mutable);
    *shell.selection.lock().unwrap() = selected;
    Ok(())
}
#[tauri::command]
pub async fn reader_open(
    shell: State<'_, Shell>,
    generation: String,
    id: String,
) -> Result<ReaderDocument> {
    shell.core.open_reader(&generation, &id).await
}
#[tauri::command]
pub async fn reader_close(
    shell: State<'_, Shell>,
    generation: String,
    handle: String,
) -> Result<()> {
    shell.core.close_reader(&generation, &handle).await
}
#[tauri::command]
pub async fn reader_marks(
    shell: State<'_, Shell>,
    generation: String,
    handle: String,
) -> Result<Vec<Annotation>> {
    let (a, id) = shell.core.document_account(&generation, &handle).await?;
    let _lease = a.lease.read().await;
    a.annotations(&id).await
}
#[tauri::command]
pub async fn reader_marks_watch(
    shell: State<'_, Shell>,
    window: WebviewWindow,
    generation: String,
    handle: String,
    channel: Channel<Vec<Annotation>>,
) -> Result<String> {
    let core = shell.core.clone();
    let (a, id) = core.document_account(&generation, &handle).await?;
    let document = a.document_cancel(&handle)?;
    let watch = slax_core::auth::opaque();
    let cancel = document.child_token();
    core.watches
        .lock()
        .await
        .insert(watch.clone(), cancel.clone());
    let key = watch.clone();
    tauri::async_runtime::spawn(async move {
        let changes = a.db.watch_tables(
            false,
            [
                "sr_bookmark_comment",
                "sr_sharer_setting",
                "sr_collection_bookmark",
            ],
        );
        let mut events = core.events.subscribe();
        pin_mut!(changes);
        let mut last: Option<Vec<Annotation>> = None;
        let mut dirty = true;
        loop {
            if cancel.is_cancelled() {
                break;
            }
            if dirty && window.is_visible().unwrap_or(false) {
                dirty = false;
                let marks = {
                    let _lease = a.lease.read().await;
                    if a.document_id(&handle).is_err() {
                        break;
                    }
                    a.annotations(&id).await
                };
                if let Ok(marks) = marks
                    && last.as_ref() != Some(&marks)
                {
                    if channel.send(marks.clone()).is_err() {
                        break;
                    }
                    last = Some(marks);
                }
            }
            tokio::select! {
                _ = cancel.cancelled() => break,
                v = changes.next() => { if v.is_none() { break } dirty = true; }
                v = events.changed() => { if v.is_err() { break } }
            }
            tokio::select! {_=cancel.cancelled()=>break,_=tokio::time::sleep(Duration::from_millis(150))=>{}}
            while let Some(Some(())) = changes.next().now_or_never() {
                dirty = true;
            }
        }
        core.watches.lock().await.remove(&key);
    });
    Ok(watch)
}
#[tauri::command]
pub async fn reader_marks_unwatch(shell: State<'_, Shell>, watch_id: String) -> Result<()> {
    shell.core.cancel(&watch_id).await;
    Ok(())
}
#[tauri::command]
pub async fn reader_mark_add(
    shell: State<'_, Shell>,
    generation: String,
    handle: String,
    kind: i32,
    selection: Option<Selection>,
    comment: String,
    parent: Option<String>,
) -> Result<String> {
    let (a, id) = shell.core.document_account(&generation, &handle).await?;
    let _lease = a.lease.read().await;
    a.add_mark(&id, kind, selection, &comment, parent.as_deref())
        .await
}
#[tauri::command]
pub async fn reader_mark_delete(
    shell: State<'_, Shell>,
    generation: String,
    handle: String,
    mark: String,
) -> Result<()> {
    let (a, id) = shell.core.document_account(&generation, &handle).await?;
    let _lease = a.lease.read().await;
    a.delete_mark(&id, &mark).await
}
#[tauri::command]
pub async fn reader_progress(
    shell: State<'_, Shell>,
    generation: String,
    handle: String,
    progress: f64,
) -> Result<()> {
    if !progress.is_finite() || !(0.0..=1.0).contains(&progress) {
        return Err(CoreError::new("INVALID_PROGRESS"));
    }
    let (a, id) = shell.core.document_account(&generation, &handle).await?;
    let _lease = a.lease.read().await;
    if !a.progress_changed(&handle, progress, 0.005)? {
        return Ok(());
    }
    a.set_local(&id, json!({"progress":progress})).await
}
#[tauri::command]
pub async fn reader_copy(
    shell: State<'_, Shell>,
    generation: String,
    handle: String,
    text: String,
) -> Result<()> {
    shell.core.document_account(&generation, &handle).await?;
    if text.len() > 100000 {
        return Err(CoreError::new("SELECTION_TOO_LARGE"));
    }
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text))
        .map_err(|_| CoreError::new("CLIPBOARD_UNAVAILABLE"))
}
#[tauri::command]
pub async fn reader_external(
    shell: State<'_, Shell>,
    generation: String,
    handle: String,
    url: String,
) -> Result<()> {
    shell.core.document_account(&generation, &handle).await?;
    let url = slax_core::repository::external_url(&url)?;
    if !crate::confirm(&shell.core, crate::Prompt::OpenBrowser, url.as_str()).await {
        return Ok(());
    };
    shell.core.document_account(&generation, &handle).await?;
    open::that_detached(url.as_str()).map_err(|_| CoreError::new("BROWSER_UNAVAILABLE"))
}
#[tauri::command]
pub async fn pdf_range(
    shell: State<'_, Shell>,
    generation: String,
    handle: String,
    document_id: String,
    begin: u32,
    end: u32,
) -> Result<Response> {
    let (a, _) = shell.core.document_account(&generation, &handle).await?;
    let _lease = a.lease.read().await;
    let _files = a.files.read().await;
    Ok(Response::new(
        a.pdf_range(&handle, &document_id, begin, end).await?,
    ))
}
#[tauri::command]
pub async fn settings_build(shell: State<'_, Shell>) -> Result<BuildInfo> {
    Ok(shell.core.build.clone())
}
#[tauri::command]
pub async fn settings_get(shell: State<'_, Shell>) -> Result<Preferences> {
    Ok(shell.core.preferences.read().unwrap().clone())
}
#[tauri::command]
pub async fn settings_save(
    shell: State<'_, Shell>,
    app: tauri::AppHandle,
    preferences: Preferences,
) -> Result<()> {
    let zh = preferences.language == "zh";
    let language = shell.core.preferences.read().unwrap().language != preferences.language;
    shell.core.save_preferences(preferences).await?;
    if language {
        crate::menu::install(&app, zh).map_err(|_| CoreError::new("MENU_UNAVAILABLE"))?;
        crate::menu::set_selection(&app, shell.selection.lock().unwrap().is_some());
        shell.core.notify();
    }
    Ok(())
}
#[tauri::command]
pub async fn settings_system(shell: State<'_, Shell>) -> Result<SystemState> {
    Ok(shell.core.system.read().unwrap().clone())
}
#[tauri::command]
pub async fn settings_product(
    shell: State<'_, Shell>,
    generation: String,
    operation: String,
    input: Value,
) -> Result<Value> {
    shell.core.product(&generation, &operation, input).await
}
#[tauri::command]
pub async fn settings_browser(
    shell: State<'_, Shell>,
    generation: String,
    kind: String,
) -> Result<()> {
    shell.core.account(&generation).await?;
    let path = match kind.as_str() {
        "subscription" => "/subscription",
        "profile" => "/settings",
        _ => return Err(CoreError::new("INVALID_DESTINATION")),
    };
    let url = shell
        .core
        .web
        .join(path)
        .map_err(|_| CoreError::new("INVALID_DESTINATION"))?;
    open::that_detached(url.as_str()).map_err(|_| CoreError::new("BROWSER_UNAVAILABLE"))
}
#[tauri::command]
pub async fn library_clipboard(
    shell: State<'_, Shell>,
    generation: String,
) -> Result<Option<String>> {
    shell.core.account(&generation).await?;
    let Ok(mut clipboard) = arboard::Clipboard::new() else {
        return Ok(None);
    };
    let Ok(text) = clipboard.get_text() else {
        return Ok(None);
    };
    Ok(slax_core::repository::external_url(text.trim())
        .ok()
        .map(|u| u.to_string()))
}
#[tauri::command]
pub async fn library_capture(
    shell: State<'_, Shell>,
    generation: String,
) -> Result<Option<String>> {
    shell.core.account(&generation).await?;
    Ok(shell.capture_url.lock().unwrap().take())
}
#[tauri::command]
pub async fn ai_stream(
    shell: State<'_, Shell>,
    generation: String,
    handle: String,
    kind: String,
    force: bool,
    channel: Channel<AiChunk>,
) -> Result<String> {
    shell
        .core
        .ai(
            &generation,
            &handle,
            &kind,
            force,
            std::sync::Arc::new(move |value| channel.send(value).is_ok()),
        )
        .await
}
#[tauri::command]
pub async fn reader_share(
    shell: State<'_, Shell>,
    generation: String,
    handle: String,
    operation: String,
    input: Option<ShareSettings>,
) -> Result<ShareSettings> {
    shell
        .core
        .share(&generation, &handle, &operation, input)
        .await
}
#[tauri::command]
pub async fn reader_download(
    shell: State<'_, Shell>,
    generation: String,
    handle: String,
) -> Result<()> {
    let (a, id) = shell.core.document_account(&generation, &handle).await?;
    let _lease = a.lease.read().await;
    a.download(&id, true).await
}
#[tauri::command]
pub async fn rss_open(
    shell: State<'_, Shell>,
    generation: String,
    id: String,
) -> Result<ReaderDocument> {
    shell.core.rss_reader(&generation, &id).await
}
#[tauri::command]
pub async fn settings_clear_cache(shell: State<'_, Shell>, generation: String) -> Result<()> {
    let a = shell.core.account(&generation).await?;
    let _lease = a.lease.read().await;
    a.clear_automatic().await
}
#[tauri::command]
pub async fn settings_subscription(
    shell: State<'_, Shell>,
    generation: String,
) -> Result<Subscription> {
    shell.core.subscription(&generation).await
}
#[tauri::command]
pub async fn settings_event(
    shell: State<'_, Shell>,
    generation: String,
    name: String,
) -> Result<()> {
    shell.core.event(&generation, &name).await
}
#[tauri::command]
pub async fn pdf_import(shell: State<'_, Shell>, generation: String) -> Result<Option<String>> {
    shell.core.account(&generation).await?;
    let file = rfd::AsyncFileDialog::new()
        .add_filter("PDF", &["pdf"])
        .pick_file()
        .await;
    let Some(file) = file else { return Ok(None) };
    if !crate::confirm(
        &shell.core,
        crate::Prompt::ImportPdf,
        file.file_name().as_str(),
    )
    .await
    {
        return Ok(None);
    };
    Ok(Some(shell.core.import_pdf(&generation, file.path()).await?))
}
#[tauri::command]
pub async fn pdf_progress(
    shell: State<'_, Shell>,
    generation: String,
    handle: String,
    position: f64,
) -> Result<()> {
    let (a, id) = shell.core.document_account(&generation, &handle).await?;
    let _lease = a.lease.read().await;
    if !position.is_finite() || !(1.0..=100001.0).contains(&position) {
        return Err(CoreError::new("INVALID_PROGRESS"));
    }
    if !a.progress_changed(&handle, position, 0.01)? {
        return Ok(());
    }
    a.set_local(&id, json!({"progress":position})).await
}

#[tauri::command]
pub async fn reader_images(
    shell: State<'_, Shell>,
    generation: String,
    handle: String,
) -> Result<Vec<String>> {
    let (a, _) = shell.core.document_account(&generation, &handle).await?;
    let r = a.resources.lock().unwrap();
    let d = r
        .documents
        .get(&handle)
        .ok_or_else(|| CoreError::new("DOCUMENT_REVOKED"))?;
    Ok(d.images
        .keys()
        .map(|key| format!("slaximg://localhost/{handle}/{key}"))
        .collect())
}

#[tauri::command]
pub async fn library_search(
    shell: State<'_, Shell>,
    generation: String,
    view: String,
    query: String,
    cloud: bool,
    request_id: String,
    tags: Vec<String>,
) -> Result<Vec<Bookmark>> {
    shell
        .core
        .search(&generation, &view, &query, cloud, &request_id, &tags)
        .await
}

#[tauri::command]
pub async fn library_original(
    shell: State<'_, Shell>,
    generation: String,
    id: String,
) -> Result<()> {
    let a = shell.core.account(&generation).await?;
    let bookmark = a.bookmark(&id).await?;
    let url = slax_core::repository::external_url(&bookmark.url)?;
    if crate::confirm(&shell.core, crate::Prompt::OpenBrowser, url.as_str()).await {
        a.check()?;
        open::that_detached(url.as_str()).map_err(|_| CoreError::new("BROWSER_UNAVAILABLE"))?;
    }
    Ok(())
}
