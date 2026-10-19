use crate::{auth, dto::*, http, repository, runtime::Runtime};
use reqwest::Method;
use rusqlite::OptionalExtension;
use serde_json::{Value, json};
use std::path::Path;
impl Runtime {
    pub async fn share(
        &self,
        generation: &str,
        handle: &str,
        operation: &str,
        input: Option<ShareSettings>,
    ) -> Result<ShareSettings> {
        let (a, id) = self.document_account(generation, handle).await?;
        let _lease = a.lease.read().await;
        if a.bookmark(&id).await?.owner_id.is_some() {
            return Err(CoreError::new("FORBIDDEN"));
        }
        let data = match operation {
            "get" => {
                a.api(
                    &format!("/v1/share/exists?bookmark_uid={id}"),
                    Method::GET,
                    None,
                )
                .await?
            }
            "save" => {
                let input = input.ok_or_else(|| CoreError::new("INVALID_SHARE"))?;
                if input.enabled {
                    a.api("/v1/share/update",Method::POST,Some(&json!({"bookmark_uid":id,"show_comment_line":input.show_line,"show_userinfo":input.show_profile,"allow_action":true}))).await?
                } else {
                    let metadata = a
                        .api(
                            &format!("/v1/bookmark/metadata?bookmark_uid={id}"),
                            Method::GET,
                            None,
                        )
                        .await?;
                    let bm = metadata["bookmark_id"]
                        .as_u64()
                        .ok_or_else(|| CoreError::new("BOOKMARK_NOT_FOUND"))?;
                    a.api(
                        "/v1/share/delete",
                        Method::POST,
                        Some(&json!({"bookmark_id":bm})),
                    )
                    .await?;
                    json!({"share_code":"","show_comment_line":true,"show_userinfo":true})
                }
            }
            _ => return Err(CoreError::new("INVALID_SHARE")),
        };
        let code = data["share_code"].as_str().unwrap_or("");
        if !code
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err(CoreError::new("INVALID_SHARE"));
        }
        Ok(ShareSettings {
            enabled: !code.is_empty(),
            show_line: data["show_comment_line"] == true,
            show_comment: data["show_comment_line"] == true,
            show_profile: data["show_userinfo"] == true,
            url: if code.is_empty() {
                String::new()
            } else {
                self.web
                    .join(&format!("/s/{code}"))
                    .map_err(|_| CoreError::new("INVALID_SHARE"))?
                    .to_string()
            },
        })
    }
    pub async fn rss_reader(&self, generation: &str, id: &str) -> Result<ReaderDocument> {
        repository::identifier(id)?;
        let a = self.account(generation).await?;
        let _lease = a.lease.read().await;
        if !a.lab_enabled("rss").await? {
            return Err(CoreError::new("LABS_REQUIRED"));
        }
        let data = a
            .api(&format!("/v1/rss/entries/{id}"), Method::GET, None)
            .await?;
        let source = data["article_url"].as_str().unwrap_or(self.web.as_str());
        let html = data["content_html"]
            .as_str()
            .ok_or_else(|| CoreError::new("RSS_CONTENT_INVALID"))?;
        let handle = auth::opaque();
        let page_id = auth::opaque();
        let mut document = crate::reader::compose_async(
            html.to_string(),
            page_id.clone(),
            handle.clone(),
            source.to_string(),
            data["title"].as_str().unwrap_or("").to_string(),
            0.0,
        )
        .await?;
        document.bookmark_id = id.into();
        document.cancel = a.cancel.child_token();
        a.check()?;
        a.resources
            .lock()
            .unwrap()
            .documents
            .insert(handle.clone(), document);
        Ok(ReaderDocument {
            url: format!("slaxframe://localhost/{handle}"),
            handle,
            page_id,
            bookmark_id: id.into(),
            title: data["title"].as_str().unwrap_or("").into(),
            source_url: source.into(),
            pdf: None,
            progress: 0.0,
        })
    }
    pub async fn subscription(&self, generation: &str) -> Result<Subscription> {
        let a = self.account(generation).await?;
        let _lease = a.lease.read().await;
        let c = a.db.reader().await?;
        a.check()?;
        Ok(c.query_row("SELECT subscribed,coalesce(source_type,''),subscription_end_time FROM sr_user_subscription LIMIT 1",[],|r|Ok(Subscription{subscribed:r.get::<_,Option<i32>>(0)?.unwrap_or(0)==1,source:r.get(1)?,ends_at:r.get(2)?})).optional()?.unwrap_or(Subscription{subscribed:false,source:String::new(),ends_at:None}))
    }
    pub async fn import_pdf(&self, generation: &str, path: &Path) -> Result<String> {
        let a = self.account(generation).await?;
        let _lease = a.lease.read().await;
        if !a.lab_enabled("pdf").await? {
            return Err(CoreError::new("LABS_REQUIRED"));
        }
        let meta = tokio::fs::symlink_metadata(path).await?;
        if !meta.is_file()
            || meta.file_type().is_symlink()
            || meta.len() == 0
            || meta.len() > crate::offline::PDF_MAX_BYTES as u64
        {
            return Err(CoreError::new("PDF_UPLOAD_INVALID"));
        }
        let bytes = tokio::fs::read(path).await?;
        if !bytes.starts_with(b"%PDF-") || bytes.len() != meta.len() as usize {
            return Err(CoreError::new("PDF_UPLOAD_INVALID"));
        }
        let filename = path
            .file_name()
            .and_then(|v| v.to_str())
            .filter(|v| v.len() <= 255)
            .unwrap_or("document.pdf");
        let token = a.token().await?;
        let mut url = a.transport.url("/v1/bookmark/upload_pdf")?;
        url.query_pairs_mut().append_pair("filename", filename);
        let request = a
            .transport
            .raw_client()
            .post(url)
            .timeout(std::time::Duration::from_secs(120))
            .header("Content-Type", "application/pdf")
            .header("X-CLIENT-TYPE", "macos")
            .header("X-CLIENT-VERSION", env!("CARGO_PKG_VERSION"))
            .bearer_auth(token)
            .body(bytes);
        let response = tokio::select! {_=a.cancel.cancelled()=>return Err(CoreError::new("ACCOUNT_CHANGED")),r=request.send()=>r.map_err(|_|CoreError::new("NETWORK_FAILED"))?};
        if !response.status().is_success() {
            return Err(CoreError::http(response.status().as_u16()));
        }
        let bytes = http::bounded(response, &a.cancel, 1024 * 1024).await?;
        a.check()?;
        let result: Value =
            serde_json::from_slice(&bytes).map_err(|_| CoreError::new("PROTOCOL_FAILED"))?;
        if result["code"] != 200 {
            return Err(CoreError::new("PDF_UPLOAD_FAILED"));
        }
        let id = result["data"]["bookmark_uid"]
            .as_str()
            .ok_or_else(|| CoreError::new("PROTOCOL_FAILED"))?;
        repository::identifier(id)?;
        Ok(id.into())
    }
    pub async fn event(&self, generation: &str, name: &str) -> Result<()> {
        if ![
            "desktop_open",
            "bookmark_open",
            "ai_overview_start",
            "ai_outline_start",
        ]
        .contains(&name)
        {
            return Err(CoreError::new("EVENT_DENIED"));
        }
        let a = self.account(generation).await?;
        let _lease = a.lease.read().await;
        let token = a.token().await?;
        let path = self.root.join("device-id");
        let device = match std::fs::read_to_string(&path) {
            Ok(value) if uuid::Uuid::parse_str(&value).is_ok() => value,
            _ => {
                let value = uuid::Uuid::new_v4().to_string();
                std::fs::create_dir_all(&self.root)?;
                std::fs::write(&path, &value)?;
                value
            }
        };
        let body = json!({"events":[{"event_name":name,"occurred_at":chrono::Utc::now().to_rfc3339(),"properties":{"platform":"macos","client_version":env!("CARGO_PKG_VERSION")}}]});
        let r = a
            .transport
            .response(
                "/events",
                Method::POST,
                Some(&body),
                Some(&token),
                &a.cancel,
                &[("X-Device-ID", device)],
            )
            .await?;
        let _ = http::bounded(r, &a.cancel, 65536).await?;
        a.check()?;
        Ok(())
    }
}
