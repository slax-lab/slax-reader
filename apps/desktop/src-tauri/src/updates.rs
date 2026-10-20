use slax_core::dto::{CoreError, Result, UpdateInfo};
use tauri::Manager;
use tauri_plugin_updater::{Update, UpdaterExt};
fn configured(app: &tauri::AppHandle) -> bool {
    app.state::<crate::Shell>().core.build.environment != "local"
        && option_env!("SLAX_DESKTOP_UPDATE_ENDPOINT").is_some()
        && option_env!("SLAX_DESKTOP_UPDATE_PUBLIC_KEY").is_some()
}
async fn checked(app: &tauri::AppHandle) -> Result<Option<Update>> {
    if !configured(app) {
        return Err(CoreError::new("UPDATE_NOT_CONFIGURED"));
    }
    let profile = app.state::<crate::Shell>().core.build.clone();
    let endpoint = option_env!("SLAX_DESKTOP_UPDATE_ENDPOINT")
        .ok_or_else(|| CoreError::new("UPDATE_NOT_CONFIGURED"))?;
    let key = option_env!("SLAX_DESKTOP_UPDATE_PUBLIC_KEY")
        .ok_or_else(|| CoreError::new("UPDATE_NOT_CONFIGURED"))?;
    let url = url::Url::parse(endpoint).map_err(|_| CoreError::new("UPDATE_POLICY_FAILED"))?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err(CoreError::new("UPDATE_POLICY_FAILED"));
    }
    let update = app
        .updater_builder()
        .endpoints(vec![url.clone()])
        .map_err(|_| CoreError::new("UPDATE_POLICY_FAILED"))?
        .pubkey(key)
        .build()
        .map_err(|_| CoreError::new("UPDATE_POLICY_FAILED"))?
        .check()
        .await
        .map_err(|_| CoreError::new("UPDATE_CHECK_FAILED"))?;
    if let Some(update) = &update {
        let channel = &profile.channel;
        if update.raw_json["channel"] != *channel
            || update.raw_json["identifier"] != profile.identifier
            || update.raw_json["environment"] != profile.environment
            || update.download_url.scheme() != "https"
            || update.download_url.host_str() != url.host_str()
            || !update
                .download_url
                .path()
                .starts_with(&format!("/macos/{channel}/"))
        {
            return Err(CoreError::new("UPDATE_CHANNEL_MISMATCH"));
        }
    }
    Ok(update)
}
#[tauri::command]
pub async fn settings_update_check(app: tauri::AppHandle) -> Result<UpdateInfo> {
    if !configured(&app) {
        return Ok(UpdateInfo {
            configured: false,
            version: None,
        });
    };
    Ok(UpdateInfo {
        configured: true,
        version: checked(&app).await?.map(|u| u.version),
    })
}
#[tauri::command]
pub async fn settings_update_install(app: tauri::AppHandle) -> Result<()> {
    let Some(update) = checked(&app).await? else {
        return Ok(());
    };
    if !crate::confirm(
        &app.state::<crate::Shell>().core,
        crate::Prompt::InstallUpdate,
        &update.version,
    )
    .await
    {
        return Ok(());
    }
    // The plugin verifies the artifact signature before installing any bytes.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|_| CoreError::new("UPDATE_INSTALL_FAILED"))?;
    let core = app.state::<crate::Shell>().core.clone();
    app.state::<crate::Shell>()
        .shutting_down
        .store(true, std::sync::atomic::Ordering::SeqCst);
    core.shutdown().await;
    app.restart()
}
