use crate::{account::Account, auth, dto::CoreError, http::Transport, uploader};
use async_trait::async_trait;
use futures_util::{StreamExt, pin_mut};
use powersync::{
    BackendConnector, PowerSyncCredentials,
    error::PowerSyncError,
    http::{HttpClient, Request, Response},
};
use reqwest::Method;
use serde_json::{Value, json};
use std::{
    sync::{Arc, Weak},
    time::Duration,
};
use tokio::sync::Mutex;

/// App-owned connection configuration; the pinned SDK is consumed unchanged.
pub struct SyncHttp(pub Arc<Transport>);
#[async_trait]
impl HttpClient for SyncHttp {
    async fn send(&self, mut req: Request) -> std::result::Result<Response, PowerSyncError> {
        if (req.url.path().ends_with("/sync/stream") || req.url.path().ends_with("/sync/stream/"))
            && let Some(body) = &req.body
        {
            let mut value: Value = serde_json::from_slice(body)?;
            value["parameters"] = json!({"schema_version":"2"});
            req.body = Some(serde_json::to_vec(&value)?);
        }
        HttpClient::send(&self.0.raw_client(), req).await
    }
}
pub struct Connector {
    account: Weak<Account>,
    credentials: Mutex<Option<(String, String, u64)>>,
}
impl Connector {
    pub fn new(account: Weak<Account>) -> Self {
        Self {
            account,
            credentials: Mutex::new(None),
        }
    }
}
fn error(e: CoreError) -> PowerSyncError {
    PowerSyncError::upload_error(e)
}
fn sync_error(_: &str) -> PowerSyncError {
    error(CoreError::new("SYNC_ACCOUNT_FAILED"))
}
#[async_trait]
impl BackendConnector for Connector {
    async fn fetch_credentials(&self) -> std::result::Result<PowerSyncCredentials, PowerSyncError> {
        let a = self
            .account
            .upgrade()
            .ok_or_else(|| sync_error("Account retired"))?;
        let _lease = a.lease.read().await;
        a.check().map_err(error)?;
        let mut cache = self.credentials.lock().await;
        if let Some((endpoint, token, expiry)) = &*cache
            && *expiry > auth::now() + 60
        {
            return Ok(PowerSyncCredentials {
                endpoint: endpoint.clone(),
                token: token.clone(),
            });
        }
        let data = a
            .api("/v1/sync/token", Method::POST, None)
            .await
            .map_err(error)?;
        let endpoint = data["endpoint"]
            .as_str()
            .ok_or_else(|| sync_error("Missing endpoint"))?
            .to_string();
        let parsed = url::Url::parse(&endpoint).map_err(|_| sync_error("Invalid endpoint"))?;
        if parsed.scheme() != "https"
            && !(cfg!(debug_assertions)
                && parsed.scheme() == "http"
                && matches!(parsed.host_str(), Some("localhost" | "127.0.0.1")))
        {
            return Err(sync_error("Invalid endpoint"));
        }
        let token = data["token"]
            .as_str()
            .ok_or_else(|| sync_error("Missing credential"))?
            .to_string();
        let exp = auth::jwt_expiry(&token).map_err(error)?;
        if exp <= auth::now() + 60 {
            return Err(sync_error("Expired credential"));
        };
        a.check().map_err(error)?;
        *cache = Some((endpoint.clone(), token.clone(), exp));
        Ok(PowerSyncCredentials { endpoint, token })
    }
    async fn upload_data(&self) -> std::result::Result<(), PowerSyncError> {
        let a = self
            .account
            .upgrade()
            .ok_or_else(|| sync_error("Account retired"))?;
        let _lease = a.lease.read().await;
        a.check().map_err(error)?;
        let stream = a.db.crud_transactions();
        pin_mut!(stream);
        let mut transactions = Vec::new();
        while transactions.len() < 100 {
            match stream.next().await {
                Some(t) => transactions.push(t?),
                None => break,
            }
        }
        let mut batches: Vec<Vec<_>> = Vec::new();
        let mut batch = Vec::new();
        let mut count = 0;
        for t in transactions {
            if count > 0 && count + t.crud.len() > 20 {
                batches.push(batch);
                batch = Vec::new();
                count = 0
            }
            count += t.crud.len();
            batch.push(t)
        }
        if !batch.is_empty() {
            batches.push(batch)
        }
        for (index, batch) in batches.into_iter().enumerate() {
            if index > 0 {
                tokio::select! {_=a.cancel.cancelled()=>return Err(sync_error("Account retired")),_=tokio::time::sleep(Duration::from_millis(200))=>{}}
            }
            a.check().map_err(error)?;
            let data: Vec<_> = batch
                .iter()
                .flat_map(|t| uploader::changes(&t.crud))
                .collect();
            match a
                .api("/v1/sync/changes", Method::POST, Some(&json!(data)))
                .await
            {
                Ok(_) => {
                    for t in batch {
                        a.check().map_err(error)?;
                        t.complete().await?
                    }
                }
                Err(e) if e.status == Some(400) => {
                    for t in batch {
                        match a
                            .api(
                                "/v1/sync/changes",
                                Method::POST,
                                Some(&json!(uploader::changes(&t.crud))),
                            )
                            .await
                        {
                            Ok(_) => {}
                            Err(e) if e.status == Some(400) => {}
                            Err(e) => return Err(error(e)),
                        }
                        a.check().map_err(error)?;
                        t.complete().await?
                    }
                }
                Err(e) => return Err(error(e)),
            }
        }
        Ok(())
    }
}
