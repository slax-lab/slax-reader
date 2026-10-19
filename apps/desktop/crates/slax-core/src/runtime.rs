use crate::{
    account::Account,
    auth::{self, CredentialStore, PendingLogin, Session},
    dto::*,
    http::Transport,
    reader::Resource,
};
use futures_util::{FutureExt, StreamExt, pin_mut};
use reqwest::Method;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, RwLock},
};
use tokio::sync::{Mutex, watch};
use tokio_util::sync::CancellationToken;

pub struct Runtime {
    pub build: BuildInfo,
    pub transport: Arc<Transport>,
    pub web: url::Url,
    pub root: PathBuf,
    pub credentials: Arc<dyn CredentialStore>,
    active: Mutex<Option<Arc<Account>>>,
    transition: Mutex<()>,
    pending: Mutex<Option<PendingLogin>>,
    login_cancel: Mutex<CancellationToken>,
    callback: Mutex<()>,
    last_callback: Mutex<Option<String>>,
    pub lifetime: CancellationToken,
    pub system: RwLock<SystemState>,
    pub preferences: RwLock<Preferences>,
    pub watches: Mutex<HashMap<String, CancellationToken>>,
    /// Bumped on account, system, preference and window visibility changes.
    pub events: watch::Sender<u64>,
    cancelled: std::sync::Mutex<std::collections::VecDeque<String>>,
}
impl Runtime {
    pub fn new(
        build: BuildInfo,
        root: PathBuf,
        credentials: Arc<dyn CredentialStore>,
    ) -> Result<Self> {
        let local = build.environment == "local";
        if !["local", "preview", "beta", "main"].contains(&build.environment.as_str()) {
            return Err(CoreError::new("INVALID_ENVIRONMENT"));
        }
        let api = auth::canonical_origin_with_loopback(&build.api_origin, local)?;
        let web = auth::canonical_origin_with_loopback(&build.web_origin, local)?;
        for origin in [&api, &web] {
            let loopback = matches!(origin.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
            if local != loopback {
                return Err(CoreError::new("INVALID_ENVIRONMENT"));
            }
        }
        let transport = Arc::new(Transport::new(api)?);
        let preferences = std::fs::read(root.join("preferences.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Ok(Self {
            build,
            transport,
            web,
            root,
            credentials,
            active: Mutex::new(None),
            transition: Mutex::new(()),
            pending: Mutex::new(None),
            login_cancel: Mutex::new(CancellationToken::new()),
            callback: Mutex::new(()),
            last_callback: Mutex::new(None),
            lifetime: CancellationToken::new(),
            system: RwLock::new(SystemState::default()),
            preferences: RwLock::new(preferences),
            watches: Mutex::new(HashMap::new()),
            events: watch::channel(0).0,
            cancelled: std::sync::Mutex::new(std::collections::VecDeque::new()),
        })
    }
    pub fn notify(&self) {
        self.events.send_modify(|v| *v = v.wrapping_add(1));
    }
    /// Registers a cancellable operation; returns None when it was cancelled before registration.
    pub async fn register(&self, id: &str, token: CancellationToken) -> Option<CancellationToken> {
        {
            let mut cancelled = self.cancelled.lock().unwrap();
            if let Some(i) = cancelled.iter().position(|v| v == id) {
                cancelled.remove(i);
                return None;
            }
        }
        self.watches.lock().await.insert(id.into(), token.clone());
        Some(token)
    }
    pub async fn cancel(&self, id: &str) {
        if let Some(c) = self.watches.lock().await.remove(id) {
            c.cancel();
            return;
        }
        let mut cancelled = self.cancelled.lock().unwrap();
        cancelled.push_back(id.into());
        while cancelled.len() > 32 {
            cancelled.pop_front();
        }
    }
    pub async fn shutdown(&self) {
        self.lifetime.cancel();
        self.login_cancel.lock().await.cancel();
        if let Ok(a) = self.active().await {
            a.cancel.cancel();
            for (_, c) in self.watches.lock().await.drain() {
                c.cancel()
            }
            let _lease = a.lease.write().await;
            a.db.disconnect().await;
        }
    }
    pub async fn restore(self: &Arc<Self>) -> Result<AuthState> {
        let _transition = self.transition.lock().await;
        if self.active.lock().await.is_some() {
            return self.auth_state().await;
        }
        if let Some(raw) = self.credentials.read("pending")?
            && let Ok(p) = serde_json::from_str::<PendingLogin>(&raw)
        {
            if p.is_current(auth::now())
                && p.is_for(
                    &self.transport.origin,
                    &self.web,
                    &self.build.callback_scheme,
                )
            {
                *self.pending.lock().await = Some(p)
            } else {
                self.credentials.delete("pending")?;
            }
        }
        if let Some(raw) = self.credentials.read("session")? {
            let session: Session =
                serde_json::from_str(&raw).map_err(|_| CoreError::new("CREDENTIAL_FAILED"))?;
            if session.api_origin != self.transport.origin.origin().ascii_serialization() {
                return Err(CoreError::new("ACCOUNT_ORIGIN_MISMATCH"));
            };
            self.admit(session).await?;
        }
        self.auth_state().await
    }
    async fn admit(self: &Arc<Self>, session: Session) -> Result<()> {
        if self.active.lock().await.is_some() {
            return Err(CoreError::new("SIGN_OUT_REQUIRED"));
        }
        let account = Account::open(
            self.root.clone(),
            session,
            self.transport.clone(),
            self.credentials.clone(),
        )
        .await?;
        *self.active.lock().await = Some(account.clone());
        self.notify();
        let runtime = Arc::downgrade(self);
        tokio::spawn(async move {
            let _lease = account.lease.read().await;
            if account.check().is_ok() {
                let _ = account.connect().await;
            }
            drop(_lease);
            if let Some(r) = runtime.upgrade() {
                r.start_cache(account).await;
            }
        });
        Ok(())
    }
    pub async fn auth_state(&self) -> Result<AuthState> {
        let account = self.active.lock().await.clone();
        let (user, generation) = match account {
            Some(a) => (Some(a.user().await), a.generation.clone()),
            None => (None, String::new()),
        };
        Ok(AuthState {
            user,
            generation,
            pending: self.pending.lock().await.is_some(),
        })
    }
    pub async fn account(&self, generation: &str) -> Result<Arc<Account>> {
        let a = self
            .active
            .lock()
            .await
            .clone()
            .ok_or_else(|| CoreError::http(401))?;
        if generation != a.generation {
            return Err(CoreError::new("ACCOUNT_CHANGED"));
        };
        a.check()?;
        Ok(a)
    }
    pub async fn active(&self) -> Result<Arc<Account>> {
        let a = self
            .active
            .lock()
            .await
            .clone()
            .ok_or_else(|| CoreError::http(401))?;
        a.check()?;
        Ok(a)
    }
    pub async fn login_begin(&self) -> Result<url::Url> {
        let _transition = self.transition.lock().await;
        self.login_cancel.lock().await.cancel();
        *self.login_cancel.lock().await = CancellationToken::new();
        *self.last_callback.lock().await = None;
        let p = PendingLogin::new(
            auth::now(),
            &self.transport.origin,
            &self.web,
            &self.build.callback_scheme,
        );
        let url = p.browser_url(&self.web);
        self.credentials.write(
            "pending",
            &serde_json::to_string(&p).map_err(|_| CoreError::new("CREDENTIAL_FAILED"))?,
        )?;
        *self.pending.lock().await = Some(p);
        Ok(url)
    }
    pub async fn login_cancel(&self) -> Result<()> {
        let _transition = self.transition.lock().await;
        self.login_cancel.lock().await.cancel();
        self.pending.lock().await.take();
        self.credentials.delete("pending")?;
        Ok(())
    }
    pub async fn login_callback(self: &Arc<Self>, raw: &str) -> Result<AuthState> {
        let _callback = self.callback.lock().await;
        let delivery = auth::challenge(raw);
        if self.last_callback.lock().await.as_ref() == Some(&delivery) {
            return self.auth_state().await;
        }
        let (body, attempt, cancel) = {
            let p = self.pending.lock().await;
            let p = p
                .as_ref()
                .ok_or_else(|| CoreError::new("LOGIN_NOT_PENDING"))?;
            (
                p.exchange(raw, auth::now())?,
                p.attempt.clone(),
                self.login_cancel.lock().await.clone(),
            )
        };
        let data = self
            .transport
            .json(
                "/v1/auth/desktop/exchange",
                Method::POST,
                Some(&body),
                None,
                &cancel,
            )
            .await?;
        let _transition = self.transition.lock().await;
        let mut pending = self.pending.lock().await;
        if cancel.is_cancelled() || pending.as_ref().is_none_or(|p| p.attempt != attempt) {
            return Err(CoreError::new("LOGIN_CANCELLED"));
        }
        let token = data["token"]
            .as_str()
            .ok_or_else(|| CoreError::new("PROTOCOL_FAILED"))?
            .to_string();
        let user: User = serde_json::from_value(data["user"].clone())
            .map_err(|_| CoreError::new("PROTOCOL_FAILED"))?;
        let exp = auth::jwt_expiry(&token)?;
        let declared = auth::iso_expiry(data["expires_at"].as_str().unwrap_or(""))?;
        if exp <= auth::now() + 60 || declared != exp {
            return Err(CoreError::new("INVALID_CREDENTIAL"));
        };
        auth::account_key(&self.transport.origin, &user.uuid)?;
        let session = Session {
            token,
            expires_at: exp,
            user,
            api_origin: self.transport.origin.origin().ascii_serialization(),
        };
        let active = self.active.lock().await.clone();
        if let Some(account) = active {
            if account.user().await.uuid != session.user.uuid {
                return Err(CoreError::new("ACCOUNT_SWITCH_REQUIRED"));
            }
            let _lease = account.lease.read().await;
            let _refresh = account.refresh.lock().await;
            account.check()?;
            self.credentials.write(
                "session",
                &serde_json::to_string(&session)
                    .map_err(|_| CoreError::new("CREDENTIAL_FAILED"))?,
            )?;
            *account.session.lock().await = session;
            drop(_refresh);
            drop(_lease);
            tokio::spawn(async move {
                let _lease = account.lease.read().await;
                if account.check().is_ok() {
                    account.db.disconnect().await;
                    let _ = account.connect().await;
                }
            });
        } else {
            self.admit(session.clone()).await?;
            self.credentials.write(
                "session",
                &serde_json::to_string(&session)
                    .map_err(|_| CoreError::new("CREDENTIAL_FAILED"))?,
            )?;
        }
        pending.take();
        self.credentials.delete("pending")?;
        *self.last_callback.lock().await = Some(delivery);
        drop(pending);
        self.auth_state().await
    }
    pub async fn logout(&self, generation: &str, discard: bool) -> Result<()> {
        let _transition = self.transition.lock().await;
        let a = self.account(generation).await?;
        if a.pending().await? > 0 && !discard {
            return Err(CoreError::new("PENDING_WRITES"));
        }
        self.login_cancel.lock().await.cancel();
        a.cancel.cancel();
        for (_, c) in self.watches.lock().await.drain() {
            c.cancel()
        }
        let _lease = a.lease.write().await;
        a.db.disconnect().await;
        a.resources.lock().unwrap().documents.clear();
        a.subscriptions.lock().await.clear();
        a.reader_subscriptions.lock().await.clear();
        a.remote_bookmarks.lock().unwrap().clear();
        self.credentials.delete("session")?;
        self.credentials.delete("pending")?;
        self.pending.lock().await.take();
        self.active.lock().await.take();
        self.notify();
        let root = a.root.clone();
        tokio::task::spawn_blocking(move || std::fs::remove_dir_all(root))
            .await
            .map_err(|_| CoreError::new("FILE_WRITE_FAILED"))??;
        Ok(())
    }
    pub async fn snapshot(
        &self,
        generation: &str,
        view: &str,
        tag_ids: &[String],
    ) -> Result<LibrarySnapshot> {
        let a = self.account(generation).await?;
        let _lease = a.lease.read().await;
        a.check()?;
        let (bookmarks, tags) = a.library(view, tag_ids).await?;
        let collections = a.collections().await?;
        let sync = self.sync_state(&a).await?;
        a.check()?;
        Ok(LibrarySnapshot {
            generation: a.generation.clone(),
            revision: 0,
            bookmarks,
            tags,
            collections,
            sync,
        })
    }
    pub async fn sync_state(&self, a: &Account) -> Result<SyncState> {
        let status = a.db.status();
        let system = self.system.read().unwrap().clone();
        Ok(SyncState {
            online: system.online,
            expensive: system.expensive,
            constrained: system.constrained,
            sleeping: system.sleeping,
            connected: status.is_connected(),
            downloading: status.is_downloading(),
            uploading: status.is_uploading(),
            has_synced: status.has_synced(),
            pending: a.pending().await?,
            error: status.any_error().is_some(),
            auth_required: a.session.lock().await.expires_at <= auth::now(),
            streams: status
                .streams()
                .map(|s| {
                    format!(
                        "{}:{}",
                        s.subscription.description().name,
                        s.subscription.is_active()
                    )
                })
                .collect(),
        })
    }
    pub async fn mutate(&self, g: &str, id: &str, action: BookmarkAction) -> Result<()> {
        let a = self.account(g).await?;
        let _lease = a.lease.read().await;
        a.check()?;
        a.mutate(id, action).await
    }
    pub async fn add_url(&self, g: &str, url: &str) -> Result<String> {
        let a = self.account(g).await?;
        let _lease = a.lease.read().await;
        a.add_url(url).await
    }
    pub async fn open_reader(&self, g: &str, id: &str) -> Result<ReaderDocument> {
        let a = self.account(g).await?;
        let _lease = a.lease.read().await;
        a.check()?;
        let (d, bookmark) = a.open_reader(id).await?;
        if bookmark.owner_id.is_none() && !bookmark.read {
            a.mutate(id, BookmarkAction::Read(true)).await?;
        }
        let params = if let Some(owner) = &bookmark.owner_id {
            json!({"bookmark_uuid":id,"owner_id":owner})
        } else {
            json!({"bookmark_uuid":id})
        };
        let stream = if bookmark.owner_id.is_some() {
            "collection_bookmark_comment"
        } else {
            "bookmark_comment"
        };
        let mut options = powersync::StreamSubscriptionOptions::default();
        options.with_ttl(std::time::Duration::from_secs(5 * 24 * 3600));
        let s =
            a.db.sync_stream(stream, Some(&params))
                .subscribe_with(options)
                .await?;
        a.check()?;
        a.reader_subscriptions
            .lock()
            .await
            .insert(d.handle.clone(), s);
        Ok(d)
    }
    pub async fn close_reader(&self, g: &str, handle: &str) -> Result<()> {
        let a = self.account(g).await?;
        a.resources.lock().unwrap().documents.remove(handle);
        a.reader_subscriptions.lock().await.remove(handle);
        Ok(())
    }
    pub async fn resource(&self, uri: &str) -> Result<Resource> {
        let a = self.active().await?;
        let _lease = a.lease.read().await;
        a.check()?;
        let _files = a.files.read().await;
        if uri.starts_with("slaxframe:") {
            a.frame(uri)
        } else {
            a.image(uri).await
        }
    }
    pub async fn document_account(&self, g: &str, handle: &str) -> Result<(Arc<Account>, String)> {
        let a = self.account(g).await?;
        let id = a.document_id(handle)?;
        Ok((a, id))
    }
    pub async fn save_preferences(&self, p: Preferences) -> Result<()> {
        crate::offline::cache_limit(p.latest_n)?;
        if !(180..=320).contains(&p.sidebar_width) || !(260..=560).contains(&p.list_width) {
            return Err(CoreError::new("INVALID_PREFERENCES"));
        }
        if !["en", "zh"].contains(&p.language.as_str())
            || !["system", "light", "dark"].contains(&p.appearance.as_str())
        {
            return Err(CoreError::new("INVALID_PREFERENCES"));
        }
        std::fs::create_dir_all(&self.root)?;
        let temp = self.root.join("preferences.tmp");
        std::fs::write(
            &temp,
            serde_json::to_vec(&p).map_err(|_| CoreError::new("INVALID_PREFERENCES"))?,
        )?;
        std::fs::rename(temp, self.root.join("preferences.json"))?;
        let cache = self.preferences.read().unwrap().latest_n != p.latest_n;
        *self.preferences.write().unwrap() = p;
        if cache {
            self.notify();
        }
        Ok(())
    }
    pub async fn proxy_changed(&self) -> Result<()> {
        self.transport.refresh_proxy()?;
        if let Ok(a) = self.active().await {
            let _lease = a.lease.read().await;
            a.check()?;
            let state = self.system.read().unwrap().clone();
            if state.online && !state.sleeping {
                a.db.disconnect().await;
                a.connect().await?;
            }
        }
        Ok(())
    }
    pub async fn signal(&self, state: SystemState) -> Result<()> {
        let old = self.system.read().unwrap().clone();
        *self.system.write().unwrap() = state.clone();
        if old != state {
            self.notify();
        }
        if old.online != state.online || old.sleeping != state.sleeping {
            if state.online && !state.sleeping {
                self.transport.refresh_proxy()?;
            }
            if let Ok(a) = self.active().await {
                let _lease = a.lease.read().await;
                a.check()?;
                if state.online && !state.sleeping {
                    a.connect().await?
                } else {
                    a.db.disconnect().await;
                }
            }
        }
        Ok(())
    }
    async fn start_cache(self: Arc<Self>, a: Arc<Account>) {
        let mut failures = HashMap::<String, (u8, u64)>::new();
        let mut events = self.events.subscribe();
        let changes = a.db.watch_tables(true, ["sr_user_bookmark"]);
        pin_mut!(changes);
        let mut kept: Option<(u32, HashSet<String>)> = None;
        let mut retry: Option<std::time::Duration> = None;
        loop {
            let wait = retry
                .take()
                .unwrap_or(std::time::Duration::from_secs(24 * 3600));
            tokio::select! {
                _ = a.cancel.cancelled() => break,
                v = changes.next() => if v.is_none() { break },
                v = events.changed() => if v.is_err() { break },
                _ = tokio::time::sleep(wait) => {}
            }
            tokio::select! {_=a.cancel.cancelled()=>break,_=tokio::time::sleep(std::time::Duration::from_secs(2))=>{}}
            while let Some(Some(())) = changes.next().now_or_never() {}
            let state = self.system.read().unwrap().clone();
            if !state.online || state.sleeping {
                continue;
            }
            let _lease = a.lease.read().await;
            if a.check().is_err() {
                break;
            }
            let n = self.preferences.read().unwrap().latest_n;
            let rows = {
                let c = match a.db.reader().await {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let Ok(mut s) = c.prepare("SELECT b.id,coalesce(json_extract(l.data,'$.is_downloaded'),0)=2,coalesce(json_extract(b.metadata,'$.bookmark.status'),'pending')='success' FROM sr_user_bookmark b LEFT JOIN ps_data_local__local_bookmark_info l ON l.id=b.id WHERE b.deleted_at IS NULL ORDER BY b.created_at DESC LIMIT ?1") else {
                    continue;
                };
                let Ok(mapped) = s.query_map([if n == 0 { -1 } else { n as i64 }], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, bool>(1)?,
                        r.get::<_, bool>(2)?,
                    ))
                }) else {
                    continue;
                };
                mapped.filter_map(|v| v.ok()).collect::<Vec<_>>()
            };
            let keep: HashSet<String> = rows.iter().map(|r| r.0.clone()).collect();
            if kept.as_ref() != Some(&(n, keep.clone())) {
                match a.prune_automatic(&keep).await {
                    Ok(true) => kept = Some((n, keep)),
                    _ => retry = Some(std::time::Duration::from_secs(30)),
                }
            }
            for (id, downloaded, ready) in rows {
                let state = self.system.read().unwrap().clone();
                if a.cancel.is_cancelled() || state.sleeping || !state.online {
                    break;
                }
                if downloaded || !ready {
                    continue;
                }
                if let Some((count, last)) = failures.get(&id) {
                    let elapsed = auth::now().saturating_sub(*last);
                    if *count >= 3 && elapsed < 300 {
                        let wait = std::time::Duration::from_secs(300 - elapsed);
                        retry = Some(retry.map_or(wait, |r| r.min(wait)));
                        continue;
                    }
                }
                match a.download(&id, false).await {
                    Ok(()) => {
                        failures.remove(&id);
                    }
                    Err(_) => {
                        let entry = failures.entry(id).or_insert((0, 0));
                        entry.0 = entry.0.saturating_add(1);
                        entry.1 = auth::now();
                        let wait =
                            std::time::Duration::from_secs(if entry.0 >= 3 { 300 } else { 10 });
                        retry = Some(retry.map_or(wait, |r| r.min(wait)));
                    }
                }
            }
        }
    }
    pub async fn product(&self, g: &str, operation: &str, input: Value) -> Result<Value> {
        let a = self.account(g).await?;
        let _lease = a.lease.read().await;
        a.check()?;
        let text = |key: &str| -> Result<String> {
            input[key]
                .as_str()
                .filter(|s| s.len() <= 20000)
                .map(str::to_string)
                .ok_or_else(|| CoreError::new("INVALID_REQUEST"))
        };
        let id = |key: &str| -> Result<String> {
            let v = text(key)?;
            crate::repository::identifier(&v)?;
            Ok(v)
        };
        let (path, method, body) = match operation {
            "labs" => ("/v1/user/labs".into(), Method::GET, None),
            "labs_set" => {
                let key = text("key")?;
                if !["rss", "youtube", "pdf"].contains(&key.as_str())
                    || !input["enabled"].is_boolean()
                {
                    return Err(CoreError::new("INVALID_LAB"));
                }
                (
                    format!(
                        "/v1/user/setting/{}",
                        if input["enabled"] == true {
                            "enable"
                        } else {
                            "disable"
                        }
                    ),
                    Method::POST,
                    Some(json!({"key":format!("lab:{key}")})),
                )
            }
            "rss_enable" => (
                format!(
                    "/v1/user/setting/{}",
                    if input["enabled"] == true {
                        "enable"
                    } else {
                        "disable"
                    }
                ),
                Method::POST,
                Some(json!({"key":"lab:rss"})),
            ),
            "rss_list" => ("/v1/rss/subscriptions".into(), Method::GET, None),
            "rss_add" => {
                crate::repository::external_url(&text("url")?)?;
                (
                    String::from("/v1/rss/subscriptions"),
                    Method::POST,
                    Some(json!({"url":text("url")?,"remark":input["remark"]})),
                )
            }
            "rss_update" => (
                format!("/v1/rss/subscriptions/{}/update", id("id")?),
                Method::POST,
                Some(json!({"remark":input["remark"]})),
            ),
            "rss_delete" => (
                format!("/v1/rss/subscriptions/{}/delete", id("id")?),
                Method::POST,
                None,
            ),
            "rss_refresh" => (
                format!("/v1/rss/subscriptions/{}/refresh", id("id")?),
                Method::POST,
                None,
            ),
            "rss_entries" => {
                let mut u = self.transport.url("/v1/rss/entries")?;
                u.query_pairs_mut().append_pair("limit", "20");
                if input["fetch_history"] == true {
                    u.query_pairs_mut().append_pair("fetch_history", "1");
                }
                for key in ["subscription_id", "cursor"] {
                    if let Some(v) = input[key].as_str() {
                        if v.len() > 512 {
                            return Err(CoreError::new("INVALID_REQUEST"));
                        }
                        u.query_pairs_mut().append_pair(key, v);
                    }
                }
                (
                    format!("{}?{}", u.path(), u.query().unwrap_or("")),
                    Method::GET,
                    None,
                )
            }
            "rss_detail" => (format!("/v1/rss/entries/{}", id("id")?), Method::GET, None),
            "rss_save" => (
                format!("/v1/rss/entries/{}/save", id("id")?),
                Method::POST,
                None,
            ),
            "feedback" => (
                "/v1/user/report".into(),
                Method::POST,
                Some(
                    json!({"bookmark_uuid":null,"entry_point":"desktop_settings","type":"feedback","content":text("content")?,"platform":"macos","environment":"desktop","version":env!("CARGO_PKG_VERSION"),"allow_follow_up":input["allowFollowUp"]==true,"target_url":null}),
                ),
            ),
            "profile" => ("/v1/user/me".into(), Method::GET, None),

            "account_delete" => {
                if input["confirmation"] != a.user().await.email {
                    return Err(CoreError::new("CONFIRMATION_REQUIRED"));
                }
                ("/v1/user/delete_my_account".into(), Method::POST, None)
            }
            _ => return Err(CoreError::new("UNKNOWN_OPERATION")),
        };
        if operation == "labs" {
            return a.labs().await;
        }
        if operation.starts_with("rss_")
            && operation != "rss_enable"
            && !a.lab_enabled("rss").await?
        {
            return Err(CoreError::new("LABS_REQUIRED"));
        }
        let result = a.api(&path, method, body.as_ref()).await;
        if matches!(operation, "labs_set" | "rss_enable") {
            a.invalidate_labs();
        }
        result
    }
}
