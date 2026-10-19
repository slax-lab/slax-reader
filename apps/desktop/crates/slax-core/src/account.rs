use crate::{
    auth::{self, CredentialStore, Session},
    dto::*,
    http::Transport,
    schema,
    sync::Connector,
};
use powersync::{
    ConnectionPool, PowerSyncDatabase, StreamSubscription, SyncOptions, env::PowerSyncEnvironment,
};
use reqwest::Method;
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc};
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

pub struct Account {
    pub key: String,
    pub generation: String,
    pub root: PathBuf,
    pub db: Arc<PowerSyncDatabase>,
    pub cancel: CancellationToken,
    pub lease: RwLock<()>,
    pub files: RwLock<()>,
    pub session: Mutex<Session>,
    pub refresh: Mutex<()>,
    pub transport: Arc<Transport>,
    pub credentials: Arc<dyn CredentialStore>,
    pub subscriptions: Mutex<Vec<StreamSubscription>>,
    pub reader_subscriptions: Mutex<std::collections::HashMap<String, StreamSubscription>>,
    pub remote_bookmarks: std::sync::Mutex<std::collections::HashMap<String, Bookmark>>,
    pub resources: std::sync::Mutex<crate::reader::Resources>,
    labs: std::sync::Mutex<Option<(std::time::Instant, Value)>>,
}
impl Account {
    pub async fn open(
        root: PathBuf,
        session: Session,
        transport: Arc<Transport>,
        credentials: Arc<dyn CredentialStore>,
    ) -> Result<Arc<Self>> {
        let key = auth::account_key(&transport.origin, &session.user.uuid)?;
        let root = root.join("accounts").join(&key);
        if root
            .symlink_metadata()
            .is_ok_and(|m| m.file_type().is_symlink())
        {
            return Err(CoreError::new("ACCOUNT_PATH_DENIED"));
        }
        std::fs::create_dir_all(&root)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))?;
        }
        let admission = json!({"origin":transport.origin.origin().ascii_serialization(),"user":session.user.uuid,"schema":2});
        let file = root.join("admission.json");
        if file.exists() {
            let prior: Value = serde_json::from_slice(&std::fs::read(&file)?)
                .map_err(|_| CoreError::new("ACCOUNT_ADMISSION_FAILED"))?;
            if prior != admission {
                return Err(CoreError::new("ACCOUNT_ADMISSION_FAILED"));
            }
        }
        PowerSyncEnvironment::powersync_auto_extension()?;
        let db = PowerSyncDatabase::new(
            PowerSyncEnvironment::custom(
                crate::sync::SyncHttp(transport.clone()),
                ConnectionPool::open(root.join("reader.sqlite"))?,
                PowerSyncEnvironment::tokio(),
            ),
            schema::schema(),
        );
        {
            let c = db.reader().await?;
            c.query_row("SELECT count(*) FROM sr_user_bookmark", [], |r| {
                r.get::<_, i64>(0)
            })?;
        }
        std::fs::write(file, admission.to_string())?;
        let account = Arc::new(Self {
            key,
            generation: auth::opaque(),
            root,
            db: Arc::new(db),
            cancel: CancellationToken::new(),
            lease: RwLock::new(()),
            files: RwLock::new(()),
            session: Mutex::new(session),
            refresh: Mutex::new(()),
            transport,
            credentials,
            subscriptions: Mutex::new(Vec::new()),
            reader_subscriptions: Mutex::new(std::collections::HashMap::new()),
            remote_bookmarks: std::sync::Mutex::new(std::collections::HashMap::new()),
            resources: std::sync::Mutex::new(crate::reader::Resources::default()),
            labs: std::sync::Mutex::new(None),
        });
        Ok(account)
    }
    pub fn check(&self) -> Result<()> {
        if self.cancel.is_cancelled() {
            Err(CoreError::new("ACCOUNT_CHANGED"))
        } else {
            Ok(())
        }
    }
    pub async fn connect(self: &Arc<Self>) -> Result<()> {
        self.check()?;
        let mut subs = self.subscriptions.lock().await;
        if subs.is_empty() {
            for name in ["user_data_v1", "subscribed_collections"] {
                subs.push(self.db.sync_stream(name, None).subscribe().await?)
            }
        }
        drop(subs);
        self.db
            .connect(SyncOptions::new(Connector::new(Arc::downgrade(self))))
            .await;
        Ok(())
    }
    pub async fn token(&self) -> Result<String> {
        self.check()?;
        {
            let session = self.session.lock().await;
            if session.expires_at > auth::now() + 60 {
                return Ok(session.token.clone());
            }
        }
        let _flight = self.refresh.lock().await;
        self.check()?;
        let old = {
            let s = self.session.lock().await;
            if s.expires_at > auth::now() + 60 {
                return Ok(s.token.clone());
            };
            if s.expires_at <= auth::now() {
                return Err(CoreError::http(401));
            };
            s.token.clone()
        };
        let data = self
            .transport
            .json(
                "/v1/user/refresh",
                Method::POST,
                None,
                Some(&old),
                &self.cancel,
            )
            .await?;
        self.check()?;
        let token = data["token"]
            .as_str()
            .ok_or_else(|| CoreError::new("PROTOCOL_FAILED"))?
            .to_string();
        let exp = auth::jwt_expiry(&token)?;
        if exp <= auth::now() + 60 {
            return Err(CoreError::new("INVALID_CREDENTIAL"));
        }
        let mut s = self.session.lock().await;
        self.check()?;
        s.token = token.clone();
        s.expires_at = exp;
        self.credentials.write(
            "session",
            &serde_json::to_string(&*s).map_err(|_| CoreError::new("CREDENTIAL_FAILED"))?,
        )?;
        Ok(token)
    }
    pub async fn api(&self, path: &str, method: Method, body: Option<&Value>) -> Result<Value> {
        self.check()?;
        let token = self.token().await?;
        let data = self
            .transport
            .json(path, method, body, Some(&token), &self.cancel)
            .await?;
        self.check()?;
        Ok(data)
    }
    pub async fn pending(&self) -> Result<u32> {
        self.check()?;
        let c = self.db.reader().await?;
        Ok(c.query_row("SELECT count(*) FROM ps_crud", [], |r| r.get(0))?)
    }
    pub async fn labs(&self) -> Result<Value> {
        if let Some((at, value)) = &*self.labs.lock().unwrap()
            && at.elapsed() < std::time::Duration::from_secs(60)
        {
            return Ok(value.clone());
        }
        let value = self.api("/v1/user/labs", Method::GET, None).await?;
        *self.labs.lock().unwrap() = Some((std::time::Instant::now(), value.clone()));
        Ok(value)
    }
    pub fn invalidate_labs(&self) {
        self.labs.lock().unwrap().take();
    }
    pub async fn lab_enabled(&self, key: &str) -> Result<bool> {
        Ok(self.labs().await?["features"]
            .as_array()
            .is_some_and(|v| v.iter().any(|v| v["key"] == key && v["enabled"] == true)))
    }
    pub async fn user(&self) -> User {
        self.session.lock().await.user.clone()
    }
}
