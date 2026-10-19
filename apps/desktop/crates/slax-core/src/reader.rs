use crate::{
    account::Account,
    auth,
    dto::*,
    http::{self, public_ip},
    repository::external_url,
};
use futures_util::{StreamExt, TryStreamExt};
use reqwest::Method;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio_util::sync::CancellationToken;
use url::Url;

#[derive(Default)]
pub struct Resources {
    pub documents: HashMap<String, Document>,
}
pub struct Document {
    pub bookmark_id: String,
    pub page_id: String,
    pub html: Vec<u8>,
    pub images: HashMap<String, Image>,
    pub pdf: Option<PdfDocument>,
    pub progress: f64,
    pub cancel: CancellationToken,
    pub pdf_state: Arc<PdfState>,
}
#[derive(Default)]
pub struct PdfState {
    verified: AtomicBool,
    verify: tokio::sync::Mutex<()>,
    flight: tokio::sync::Mutex<()>,
}
impl Drop for Document {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
pub struct Image {
    pub url: Url,
    pub referer: String,
}
pub struct Resource {
    pub bytes: Vec<u8>,
    pub mime: String,
    pub csp: Option<String>,
}
pub fn csp(nonce: &str) -> String {
    format!(
        "default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; img-src slaximg:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    )
}
pub async fn compose_async(
    raw: String,
    page: String,
    handle: String,
    source: String,
    title: String,
    progress: f64,
) -> Result<Document> {
    tokio::task::spawn_blocking(move || {
        compose(&raw, &page, "1", &handle, &source, &title, progress)
    })
    .await
    .map_err(|_| CoreError::new("READER_COMPOSE_FAILED"))?
}
fn article_assets() -> &'static (String, &'static str) {
    static ASSETS: OnceLock<(String, &'static str)> = OnceLock::new();
    ASSETS.get_or_init(|| {
        (
            [
                include_str!("../../../../../packages/reader-embed/assets/css/reset.css"),
                include_str!("../../../../../packages/reader-embed/assets/css/article.css"),
                include_str!("../../../../../packages/reader-embed/assets/css/mark.css"),
                include_str!("../../../reader-frame/article.css"),
            ]
            .join("\n"),
            include_str!("../../../../../packages/reader-embed/assets/js/webview-bridge.js"),
        )
    })
}
pub fn compose(
    raw: &str,
    page: &str,
    user: &str,
    handle: &str,
    source: &str,
    title: &str,
    progress: f64,
) -> Result<Document> {
    if raw.len() > 16 * 1024 * 1024 {
        return Err(CoreError::new("ARTICLE_TOO_LARGE"));
    }
    let nonce = auth::opaque();
    let images = Arc::new(Mutex::new(HashMap::new()));
    let registered = images.clone();
    let base = external_url(source)?;
    let handle = handle.to_owned();
    let mut clean = ammonia::Builder::default();
    clean
        .url_schemes(HashSet::from(["http", "https"]))
        .add_generic_attributes(["id"])
        .link_rel(Some("noreferrer noopener"))
        .attribute_filter(move |element, attr, value| {
            if element == "img" && attr == "src" {
                let mut url = base.join(value).ok().filter(|u| {
                    matches!(u.scheme(), "https" | "http")
                        && u.username().is_empty()
                        && u.password().is_none()
                })?;
                // Saved HTML contains the signed first-party image proxy. Resolve its
                // public source; the native loader still applies DNS and MIME admission.
                if url.path() == "/static/image"
                    && let Some((_, encoded)) = url.query_pairs().find(|(k, _)| k == "u")
                {
                    let pair = format!("u={encoded}");
                    let decoded = url::form_urlencoded::parse(pair.as_bytes())
                        .next()
                        .map(|(_, v)| v.into_owned())?;
                    url = external_url(&decoded).ok()?;
                }
                let key = auth::opaque();
                registered.lock().unwrap().insert(
                    key.clone(),
                    Image {
                        url,
                        referer: base.origin().ascii_serialization(),
                    },
                );
                Some(Cow::Owned(format!("slaximg://localhost/{handle}/{key}")))
            } else {
                if element == "a" && attr == "href" && !value.starts_with('#') {
                    let url = base.join(value).ok().filter(|u| {
                        matches!(u.scheme(), "https" | "http")
                            && u.username().is_empty()
                            && u.password().is_none()
                    })?;
                    Some(Cow::Owned(url.to_string()))
                } else {
                    Some(Cow::Borrowed(value))
                }
            }
        });
    let body = clean.clean(raw).to_string();
    let (css, bridge) = article_assets();
    let heading = heading(title, source);
    let progress = if progress.is_finite() {
        progress.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let config = json!({"pageId":page,"userId":user,"progress":progress})
        .to_string()
        .replace('<', "\\u003c");
    let host = include_str!("../../../reader-frame/tauri-frame-host.js")
        .replace("__SLAX_READER_CONFIGURATION__", &config);
    let html = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"{}\"><meta name=\"referrer\" content=\"no-referrer\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style nonce=\"{nonce}\">{css}</style></head><body>{heading}<slax-content id=\"slax-article-content\">{body}</slax-content><script nonce=\"{nonce}\">{bridge}</script><script nonce=\"{nonce}\">{host}</script></body></html>",
        csp(&nonce)
    );
    drop(clean);
    let images = Arc::try_unwrap(images)
        .map_err(|_| CoreError::new("READER_COMPOSE_FAILED"))?
        .into_inner()
        .unwrap();
    Ok(Document {
        bookmark_id: String::new(),
        page_id: page.into(),
        html: html.into_bytes(),
        images,
        pdf: None,
        progress,
        cancel: CancellationToken::new(),
        pdf_state: Arc::default(),
    })
}
async fn write_atomic(path: PathBuf, bytes: Vec<u8>) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let mut temp = path.clone().into_os_string();
        temp.push(".part");
        std::fs::write(&temp, bytes)?;
        std::fs::rename(&temp, &path)
    })
    .await
    .map_err(|_| CoreError::new("FILE_WRITE_FAILED"))??;
    Ok(())
}
fn read_range(path: &Path, begin: u64, len: usize) -> std::io::Result<Vec<u8>> {
    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(begin))?;
    let mut bytes = vec![0; len];
    file.read_exact(&mut bytes)?;
    Ok(bytes)
}
impl Account {
    pub async fn open_reader(&self, id: &str) -> Result<(ReaderDocument, Bookmark)> {
        let _files = self.files.read().await;
        let bookmark = self.bookmark(id).await?;
        if bookmark.status != "success" {
            return Err(CoreError::new("ARTICLE_PROCESSING"));
        }
        let local = self.local(id).await?;
        let progress = local["progress"].as_f64().unwrap_or(0.0);
        let handle = auth::opaque();
        let page_id = auth::opaque();
        let mut pdf = None;
        let mut doc = if bookmark.content_type == 2 {
            let descriptor = if let Some(p) = local.get("pdf") {
                serde_json::from_value::<PdfDocument>(p.clone())
                    .map_err(|_| CoreError::new("PDF_METADATA_INVALID"))?
            } else {
                let data = self
                    .api(
                        &format!("/v1/bookmark/metadata?bookmark_uid={id}"),
                        Method::GET,
                        None,
                    )
                    .await?;
                let p = &data["pdf"];
                PdfDocument {
                    document_id: p["document_id"]
                        .as_str()
                        .ok_or_else(|| CoreError::new("PDF_METADATA_INVALID"))?
                        .into(),
                    size: p["size"]
                        .as_u64()
                        .and_then(|v| u32::try_from(v).ok())
                        .ok_or_else(|| CoreError::new("PDF_METADATA_INVALID"))?,
                    filename: p["filename"].as_str().unwrap_or("document.pdf").into(),
                }
            };
            if descriptor.document_id.len() != 64
                || !descriptor
                    .document_id
                    .bytes()
                    .all(|v| v.is_ascii_hexdigit() && !v.is_ascii_uppercase())
                || descriptor.size == 0
                || descriptor.size as usize > crate::offline::PDF_MAX_BYTES
            {
                return Err(CoreError::new("PDF_METADATA_INVALID"));
            }
            if local.get("pdf") != Some(&json!(descriptor)) {
                self.set_local(id, json!({"pdf":descriptor})).await?;
            }
            pdf = Some(descriptor.clone());
            Document {
                bookmark_id: id.into(),
                page_id: page_id.clone(),
                html: compose_pdf(
                    &descriptor,
                    &page_id,
                    progress,
                    &bookmark.title,
                    &bookmark.url,
                ),
                images: HashMap::new(),
                pdf: Some(descriptor),
                progress,
                cancel: CancellationToken::new(),
                pdf_state: Arc::default(),
            }
        } else {
            let file = self.root.join(format!("{id}.html"));
            let raw = match tokio::fs::read_to_string(&file).await {
                Ok(raw) => raw,
                Err(_) => {
                    let token = self.token().await?;
                    let r = self
                        .transport
                        .response(
                            "/v1/bookmark/content",
                            Method::POST,
                            Some(&json!({"bookmark_uid":id})),
                            Some(&token),
                            &self.cancel,
                            &[],
                        )
                        .await?;
                    let b = http::bounded(r, &self.cancel, 16 * 1024 * 1024).await?;
                    self.check()?;
                    let raw =
                        String::from_utf8(b).map_err(|_| CoreError::new("ARTICLE_INVALID"))?;
                    write_atomic(file, raw.clone().into_bytes()).await?;
                    raw
                }
            };
            compose_async(
                raw,
                page_id.clone(),
                handle.clone(),
                bookmark.url.clone(),
                bookmark.title.clone(),
                progress,
            )
            .await?
        };
        doc.bookmark_id = id.into();
        doc.cancel = self.cancel.child_token();
        self.check()?;
        self.resources
            .lock()
            .unwrap()
            .documents
            .insert(handle.clone(), doc);
        Ok((
            ReaderDocument {
                url: format!("slaxframe://localhost/{handle}"),
                handle,
                page_id,
                bookmark_id: id.into(),
                title: bookmark.title.clone(),
                source_url: bookmark.url.clone(),
                pdf,
                progress,
            },
            bookmark,
        ))
    }
    pub fn document_id(&self, handle: &str) -> Result<String> {
        self.check()?;
        self.resources
            .lock()
            .unwrap()
            .documents
            .get(handle)
            .map(|v| v.bookmark_id.clone())
            .ok_or_else(|| CoreError::new("DOCUMENT_REVOKED"))
    }
    pub fn document_cancel(&self, handle: &str) -> Result<CancellationToken> {
        self.check()?;
        self.resources
            .lock()
            .unwrap()
            .documents
            .get(handle)
            .map(|v| v.cancel.clone())
            .ok_or_else(|| CoreError::new("DOCUMENT_REVOKED"))
    }
    /// Returns false when the value is within the persistence threshold of the last write.
    pub fn progress_changed(&self, handle: &str, value: f64, threshold: f64) -> Result<bool> {
        self.check()?;
        let mut resources = self.resources.lock().unwrap();
        let d = resources
            .documents
            .get_mut(handle)
            .ok_or_else(|| CoreError::new("DOCUMENT_REVOKED"))?;
        if (d.progress - value).abs() < threshold {
            return Ok(false);
        }
        d.progress = value;
        Ok(true)
    }
    pub fn frame(&self, uri: &str) -> Result<Resource> {
        self.check()?;
        let u = Url::parse(uri).map_err(|_| CoreError::new("RESOURCE_DENIED"))?;
        if u.scheme() != "slaxframe"
            || u.host_str() != Some("localhost")
            || u.query().is_some()
            || u.fragment().is_some()
        {
            return Err(CoreError::new("RESOURCE_DENIED"));
        }
        let h = u.path().trim_start_matches('/');
        let resources = self.resources.lock().unwrap();
        let d = resources
            .documents
            .get(h)
            .ok_or_else(|| CoreError::new("DOCUMENT_REVOKED"))?;
        Ok(Resource {
            bytes: d.html.clone(),
            mime: "text/html; charset=utf-8".into(),
            csp: None,
        })
    }
    pub async fn image(&self, uri: &str) -> Result<Resource> {
        self.check()?;
        let u = Url::parse(uri).map_err(|_| CoreError::new("RESOURCE_DENIED"))?;
        if u.scheme() != "slaximg"
            || u.host_str() != Some("localhost")
            || u.query().is_some()
            || u.fragment().is_some()
        {
            return Err(CoreError::new("RESOURCE_DENIED"));
        }
        let p: Vec<_> = u.path().trim_start_matches('/').split('/').collect();
        if p.len() != 2 {
            return Err(CoreError::new("RESOURCE_DENIED"));
        }
        let (url, referer, cancel) = {
            let resources = self.resources.lock().unwrap();
            let document = resources
                .documents
                .get(p[0])
                .ok_or_else(|| CoreError::new("RESOURCE_DENIED"))?;
            let image = document
                .images
                .get(p[1])
                .ok_or_else(|| CoreError::new("RESOURCE_DENIED"))?;
            (
                image.url.clone(),
                image.referer.clone(),
                document.cancel.clone(),
            )
        };
        let key = format!("{:x}", Sha256::digest(url.as_str()));
        let cached = self.root.join("images").join(&key);
        if let (Ok(bytes), Ok(mime)) = (
            tokio::fs::read(&cached).await,
            tokio::fs::read_to_string(cached.with_extension("mime")).await,
        ) && matches!(
            mime.as_str(),
            "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/avif"
        ) && bytes.len() <= 20 * 1024 * 1024
        {
            return Ok(Resource {
                bytes,
                mime,
                csp: None,
            });
        }
        let host = url
            .host_str()
            .ok_or_else(|| CoreError::new("RESOURCE_DENIED"))?;
        let addresses = tokio::net::lookup_host((host, url.port_or_known_default().unwrap_or(443)))
            .await
            .map_err(|_| CoreError::new("NETWORK_FAILED"))?
            .collect::<Vec<_>>();
        if addresses.is_empty() || addresses.iter().any(|s| !public_ip(s.ip())) {
            return Err(CoreError::new("RESOURCE_DENIED"));
        }
        let request = self
            .transport
            .images()
            .get(url)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
            )
            .header("Referer", referer)
            .header("Accept", "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8");
        let r = tokio::select! {_=cancel.cancelled()=>return Err(CoreError::new("DOCUMENT_REVOKED")),r=request.send()=>r.map_err(|_|CoreError::new("NETWORK_FAILED"))?};
        if !r.status().is_success() {
            return Err(CoreError::http(r.status().as_u16()));
        }
        let mime = r
            .headers()
            .get("Content-Type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .to_lowercase();
        if !matches!(
            mime.as_str(),
            "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/avif"
        ) {
            return Err(CoreError::new("RESOURCE_TYPE_DENIED"));
        }
        let bytes = http::bounded(r, &cancel, 20 * 1024 * 1024).await?;
        self.check()?;
        tokio::fs::create_dir_all(self.root.join("images")).await?;
        write_atomic(cached.with_extension("mime"), mime.clone().into_bytes()).await?;
        write_atomic(cached, bytes.clone()).await?;
        Ok(Resource {
            bytes,
            mime,
            csp: None,
        })
    }
    pub async fn pdf_range(
        &self,
        handle: &str,
        document_id: &str,
        begin: u32,
        end: u32,
    ) -> Result<Vec<u8>> {
        let (id, pdf, state, cancel) = {
            let r = self.resources.lock().unwrap();
            let d = r
                .documents
                .get(handle)
                .ok_or_else(|| CoreError::new("DOCUMENT_REVOKED"))?;
            (
                d.bookmark_id.clone(),
                d.pdf
                    .clone()
                    .ok_or_else(|| CoreError::new("PDF_METADATA_INVALID"))?,
                d.pdf_state.clone(),
                d.cancel.clone(),
            )
        };
        if pdf.document_id != document_id {
            return Err(CoreError::new("PDF_IDENTITY_MISMATCH"));
        }
        let range = crate::offline::range(begin, end, pdf.size)?;
        let file = self.root.join(format!("{id}.pdf"));
        if let Some(bytes) = cached_range(&file, &pdf, &state, &range).await? {
            return Ok(bytes);
        }
        let token = self.token().await?;
        let r = self
            .transport
            .response(
                &format!("/v1/bookmark/pdf?bookmark_uid={id}"),
                Method::GET,
                None,
                Some(&token),
                &cancel,
                &[
                    ("Accept", "application/pdf".into()),
                    ("Range", format!("bytes={begin}-{}", end - 1)),
                ],
            )
            .await?;
        let full = r.status() == 200;
        let headers = r.headers();
        if headers
            .get("Content-Type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            != Some("application/pdf")
        {
            return Err(CoreError::new("PDF_BODY_INVALID"));
        }
        if let Some(etag) = headers.get("ETag").and_then(|v| v.to_str().ok())
            && etag.starts_with('"')
            && etag.len() == 66
            && etag != format!("\"{document_id}\"")
        {
            return Err(CoreError::new("PDF_IDENTITY_MISMATCH"));
        }
        if full {
            if headers.contains_key("Content-Range") || r.content_length() != Some(pdf.size as u64)
            {
                return Err(CoreError::new("PDF_LENGTH_INVALID"));
            }
            // The server ignored the range: download once while concurrent ranges wait.
            let _flight = state.flight.lock().await;
            if let Some(bytes) = cached_range(&file, &pdf, &state, &range).await? {
                return Ok(bytes);
            }
            let bytes = http::bounded(r, &cancel, pdf.size as usize).await?;
            self.check()?;
            let digest = document_id.to_string();
            let size = pdf.size as usize;
            let bytes = tokio::task::spawn_blocking(move || {
                crate::offline::validate_pdf(&bytes, &digest, size).map(|_| bytes)
            })
            .await
            .map_err(|_| CoreError::new("PDF_BODY_INVALID"))??;
            let slice = bytes[range].to_vec();
            write_atomic(file, bytes).await?;
            state.verified.store(true, Ordering::Release);
            self.set_local(&id, json!({"is_downloaded":2})).await?;
            return Ok(slice);
        }
        if r.status() != 206
            || headers.get("Content-Range").and_then(|v| v.to_str().ok())
                != Some(format!("bytes {begin}-{}/{}", end - 1, pdf.size).as_str())
            || r.content_length()
                .is_some_and(|v| v != (end - begin) as u64)
        {
            return Err(CoreError::new("PDF_RANGE_INVALID"));
        }
        let bytes = http::bounded(r, &cancel, (end - begin) as usize).await?;
        self.check()?;
        if bytes.len() == (end - begin) as usize {
            Ok(bytes)
        } else {
            Err(CoreError::new("PDF_LENGTH_INVALID"))
        }
    }
}
/// Serves a range from the cached file, hashing the whole file only once per document.
async fn cached_range(
    file: &Path,
    pdf: &PdfDocument,
    state: &Arc<PdfState>,
    range: &std::ops::Range<usize>,
) -> Result<Option<Vec<u8>>> {
    if !state.verified.load(Ordering::Acquire) {
        let _verify = state.verify.lock().await;
        if state.verified.load(Ordering::Acquire) {
            return read_cached(file, state, range).await;
        }
        let path = file.to_path_buf();
        let digest = pdf.document_id.clone();
        let size = pdf.size as usize;
        let found = tokio::task::spawn_blocking(move || match std::fs::read(&path) {
            Ok(bytes) => crate::offline::validate_pdf(&bytes, &digest, size).map(|_| true),
            Err(_) => Ok(false),
        })
        .await
        .map_err(|_| CoreError::new("PDF_BODY_INVALID"))??;
        if !found {
            return Ok(None);
        }
        state.verified.store(true, Ordering::Release);
    }
    read_cached(file, state, range).await
}
async fn read_cached(
    file: &Path,
    state: &Arc<PdfState>,
    range: &std::ops::Range<usize>,
) -> Result<Option<Vec<u8>>> {
    let path = file.to_path_buf();
    let (begin, len) = (range.start as u64, range.len());
    match tokio::task::spawn_blocking(move || read_range(&path, begin, len))
        .await
        .map_err(|_| CoreError::new("PDF_BODY_INVALID"))?
    {
        Ok(bytes) => Ok(Some(bytes)),
        Err(_) => {
            state.verified.store(false, Ordering::Release);
            Ok(None)
        }
    }
}
fn pdf_assets() -> &'static (String, String) {
    static ASSETS: OnceLock<(String, String)> = OnceLock::new();
    ASSETS.get_or_init(|| {
        (
            include_str!("../../../reader-frame/generated/pdf-assets.json").replace('<', "\\u003c"),
            include_str!("../../../reader-frame/generated/pdf-runtime.js")
                .replace("</script", "<\\/script"),
        )
    })
}
fn compose_pdf(pdf: &PdfDocument, page: &str, progress: f64, title: &str, source: &str) -> Vec<u8> {
    let nonce = auth::opaque();
    let options=json!({"pageId":page,"descriptor":{"document_id":pdf.document_id,"size":pdf.size,"filename":pdf.filename},"currentUserId":1,"initialPosition":progress,"labels":{"page":"Page","loading":"Loading…","error":"Unable to display PDF","mark":"Annotation"}}).to_string().replace('<',"\\u003c");
    let (assets, script) = pdf_assets();
    let css = include_str!("../../../reader-frame/pdf.css");
    let heading = heading(title, source);
    let policy = format!(
        "default-src 'none'; script-src 'nonce-{nonce}' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src blob:; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    );
    let mut html = String::with_capacity(assets.len() + script.len() + css.len() + 4096);
    html.push_str("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta http-equiv=\"Content-Security-Policy\" content=\"");
    html.push_str(&policy);
    html.push_str("\"><style>");
    html.push_str(css);
    html.push_str("</style></head><body>");
    html.push_str(&heading);
    html.push_str("<div id=\"status\" role=\"status\">Loading…</div><main id=\"pages\"></main><script nonce=\"");
    html.push_str(&nonce);
    html.push_str("\">window.__SLAX_PDF_OPTIONS__=");
    html.push_str(&options);
    html.push_str(";window.__SLAX_PDF_ASSETS__=");
    html.push_str(assets);
    html.push_str(";</script><script nonce=\"");
    html.push_str(&nonce);
    html.push_str("\">");
    html.push_str(script);
    html.push_str("</script></body></html>");
    html.into_bytes()
}
impl Account {
    pub async fn download(&self, id: &str, manual: bool) -> Result<()> {
        let _files = self.files.read().await;
        let b = self.bookmark(id).await?;
        if b.status != "success" {
            return Err(CoreError::new("ARTICLE_PROCESSING"));
        }
        let local = self.local(id).await?;
        let manual = manual || local["is_auto_cached"] == 0 || local["is_auto_cached"] == false;
        if b.content_type == 2 {
            let data = self
                .api(
                    &format!("/v1/bookmark/metadata?bookmark_uid={id}"),
                    Method::GET,
                    None,
                )
                .await?;
            let p = &data["pdf"];
            let pdf = PdfDocument {
                document_id: p["document_id"].as_str().unwrap_or("").into(),
                size: p["size"]
                    .as_u64()
                    .and_then(|v| u32::try_from(v).ok())
                    .unwrap_or(0),
                filename: p["filename"].as_str().unwrap_or("document.pdf").into(),
            };
            if pdf.document_id.len() != 64
                || pdf.size == 0
                || pdf.size as usize > crate::offline::PDF_MAX_BYTES
            {
                return Err(CoreError::new("PDF_METADATA_INVALID"));
            }
            let token = self.token().await?;
            let r = self
                .transport
                .response(
                    &format!("/v1/bookmark/pdf?bookmark_uid={id}"),
                    Method::GET,
                    None,
                    Some(&token),
                    &self.cancel,
                    &[("Accept", "application/pdf".into())],
                )
                .await?;
            if r.status() != 200
                || r.content_length() != Some(pdf.size as u64)
                || r.headers()
                    .get("Content-Type")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.split(';').next())
                    != Some("application/pdf")
            {
                return Err(CoreError::new("PDF_LENGTH_INVALID"));
            }
            let bytes = http::bounded(r, &self.cancel, crate::offline::PDF_MAX_BYTES).await?;
            let digest = pdf.document_id.clone();
            let size = pdf.size as usize;
            let bytes = tokio::task::spawn_blocking(move || {
                crate::offline::validate_pdf(&bytes, &digest, size).map(|_| bytes)
            })
            .await
            .map_err(|_| CoreError::new("PDF_BODY_INVALID"))??;
            self.check()?;
            write_atomic(self.root.join(format!("{id}.pdf")), bytes).await?;
            self.set_local(
                id,
                json!({"pdf":pdf,"is_downloaded":2,"is_auto_cached":if manual{0}else{1}}),
            )
            .await?;
        } else {
            let path = self.root.join(format!("{id}.html"));
            let raw = match tokio::fs::read_to_string(&path).await {
                Ok(raw) => raw,
                Err(_) => {
                    let token = self.token().await?;
                    let r = self
                        .transport
                        .response(
                            "/v1/bookmark/content",
                            Method::POST,
                            Some(&json!({"bookmark_uid":id})),
                            Some(&token),
                            &self.cancel,
                            &[],
                        )
                        .await?;
                    String::from_utf8(http::bounded(r, &self.cancel, 16 * 1024 * 1024).await?)
                        .map_err(|_| CoreError::new("ARTICLE_INVALID"))?
                }
            };
            let handle = auth::opaque();
            let mut doc = compose_async(
                raw.clone(),
                auth::opaque(),
                handle.clone(),
                b.url.clone(),
                b.title.clone(),
                0.0,
            )
            .await?;
            doc.bookmark_id = format!("cache:{id}");
            doc.cancel = self.cancel.child_token();
            let image_keys: Vec<_> = doc
                .images
                .values()
                .map(|i| format!("{:x}", Sha256::digest(i.url.as_str())))
                .collect();
            let urls: Vec<_> = doc
                .images
                .keys()
                .take(200)
                .map(|key| format!("slaximg://localhost/{handle}/{key}"))
                .collect();
            self.check()?;
            self.resources
                .lock()
                .unwrap()
                .documents
                .insert(handle.clone(), doc);
            let images = futures_util::stream::iter(urls)
                .map(|url| async move { self.image(&url).await.map(|_| ()) })
                .buffer_unordered(5)
                .try_collect::<Vec<_>>()
                .await;
            self.resources.lock().unwrap().documents.remove(&handle);
            images?;
            self.check()?;
            write_atomic(path, raw.into_bytes()).await?;
            self.set_local(id,json!({"is_downloaded":2,"is_auto_cached":if manual{0}else{1},"cache_images":image_keys})).await?;
        }
        Ok(())
    }
    pub async fn clear_automatic(&self) -> Result<()> {
        let _files = self.files.write().await;
        self.prune_locked(&HashSet::new()).await
    }
    /// Skips the pass instead of waiting behind in-flight reads; the cache loop retries later.
    pub async fn prune_automatic(&self, keep: &HashSet<String>) -> Result<bool> {
        let Ok(_files) = self.files.try_write() else {
            return Ok(false);
        };
        self.prune_locked(keep).await?;
        Ok(true)
    }
    async fn prune_locked(&self, keep: &HashSet<String>) -> Result<()> {
        let c = self.db.reader().await?;
        let ids=c.prepare("SELECT id FROM ps_data_local__local_bookmark_info WHERE json_extract(data,'$.is_auto_cached')=1 AND coalesce(json_extract(data,'$.is_downloaded'),0)!=0")?.query_map([],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
        drop(c);
        let active: HashSet<_> = self
            .resources
            .lock()
            .unwrap()
            .documents
            .values()
            .map(|d| d.bookmark_id.clone())
            .collect();
        for id in ids {
            if active.contains(&id) || keep.contains(&id) {
                continue;
            }
            crate::repository::identifier(&id)?;
            self.check()?;
            for ext in ["html", "pdf", "pdf.part", "html.part"] {
                match tokio::fs::remove_file(self.root.join(format!("{id}.{ext}"))).await {
                    Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
                    _ => {}
                }
            }
            self.set_local(&id, json!({"is_downloaded":0})).await?;
        }
        self.prune_images().await
    }
}

impl Account {
    async fn prune_images(&self) -> Result<()> {
        let c = self.db.reader().await?;
        let data=c.prepare("SELECT data FROM ps_data_local__local_bookmark_info WHERE json_extract(data,'$.is_downloaded')=2")?.query_map([],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
        drop(c);
        let mut retained = HashSet::new();
        for row in data {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&row)
                && let Some(keys) = value["cache_images"].as_array()
            {
                for key in keys.iter().filter_map(|v| v.as_str()) {
                    retained.insert(key.to_string());
                }
            }
        }
        for document in self.resources.lock().unwrap().documents.values() {
            for image in document.images.values() {
                retained.insert(format!("{:x}", Sha256::digest(image.url.as_str())));
            }
        }
        let dir = self.root.join("images");
        let cancel = self.cancel.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                return Ok(());
            };
            for entry in entries {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                if name.len() == 64
                    && name.bytes().all(|v| v.is_ascii_hexdigit())
                    && !retained.contains(&name)
                {
                    if cancel.is_cancelled() {
                        return Err(CoreError::new("ACCOUNT_CHANGED"));
                    }
                    std::fs::remove_file(entry.path())?;
                    let mime = entry.path().with_extension("mime");
                    if mime.exists() {
                        std::fs::remove_file(mime)?;
                    }
                }
            }
            Ok(())
        })
        .await
        .map_err(|_| CoreError::new("FILE_WRITE_FAILED"))?
    }
}

fn heading(title: &str, source: &str) -> String {
    fn escape(value: &str) -> String {
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    }
    let host = Url::parse(source)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_default();
    format!(
        "<slax-heading role=\"banner\"><slax-source>{}</slax-source><slax-title role=\"heading\" aria-level=\"1\">{}</slax-title></slax-heading>",
        escape(&host),
        escape(title)
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hostile_html() {
        let h = auth::opaque();
        let d=compose("<script>alert(1)</script><p onclick='x()'>Hello</p><iframe src='https://evil.test'></iframe><img src='https://example.org/img.png'><a href='javascript:alert(1)'>bad</a>","p","u",&h,"https://example.org/article","Title",0.0).unwrap();
        let text = String::from_utf8(d.html.clone()).unwrap();
        assert!(!text.contains("onclick"));
        assert!(!text.contains("<iframe"));
        assert!(!text.contains("javascript:alert"));
        assert!(!text.contains("<script>alert"));
        assert!(text.contains(&format!("slaximg://localhost/{h}/")));
        assert_eq!(d.images.len(), 1)
    }
    #[test]
    fn private_network() {
        for value in [
            "127.0.0.1",
            "10.0.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fd00::1",
        ] {
            assert!(!public_ip(value.parse().unwrap()))
        }
        assert!(public_ip("8.8.8.8".parse().unwrap()));
    }
}
