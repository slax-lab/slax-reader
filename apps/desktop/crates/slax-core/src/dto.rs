use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub uuid: String,
    pub name: String,
    pub email: String,
    pub picture: String,
    pub lang: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AuthState {
    pub user: Option<User>,
    pub pending: bool,
    pub generation: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    pub environment: String,
    pub channel: String,
    pub identifier: String,
    pub product_name: String,
    pub api_origin: String,
    pub web_origin: String,
    pub callback_scheme: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoreError {
    pub code: String,
    pub status: Option<u16>,
}
impl CoreError {
    pub fn new(code: &str) -> Self {
        Self {
            code: code.into(),
            status: None,
        }
    }
    pub fn http(status: u16) -> Self {
        Self {
            code: match status {
                401 => "AUTH_REQUIRED",
                403 => "FORBIDDEN",
                429 => "RATE_LIMITED",
                _ => "HTTP_FAILED",
            }
            .into(),
            status: Some(status),
        }
    }
}
impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.code)
    }
}
impl std::error::Error for CoreError {}
impl From<powersync::error::PowerSyncError> for CoreError {
    fn from(_: powersync::error::PowerSyncError) -> Self {
        Self::new("DATABASE_FAILED")
    }
}
impl From<rusqlite::Error> for CoreError {
    fn from(_: rusqlite::Error) -> Self {
        Self::new("DATABASE_FAILED")
    }
}
impl From<std::io::Error> for CoreError {
    fn from(_: std::io::Error) -> Self {
        Self::new("STORAGE_FAILED")
    }
}
pub type Result<T> = std::result::Result<T, CoreError>;
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub title: String,
    pub url: String,
    pub description: String,
    pub created_at: String,
    pub starred: bool,
    pub archived: bool,
    pub read: bool,
    pub content_type: i32,
    pub tags: Vec<String>,
    pub downloaded: bool,
    pub status: String,
    pub owner_id: Option<String>,
    pub can_annotate: bool,
    pub show_annotations: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSource {
    pub id: String,
    pub name: String,
    pub owner_id: String,
    pub available: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub online: bool,
    pub expensive: bool,
    pub constrained: bool,
    pub sleeping: bool,
    pub connected: bool,
    pub downloading: bool,
    pub uploading: bool,
    pub has_synced: bool,
    pub pending: u32,
    pub error: bool,
    pub auth_required: bool,
    pub streams: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub generation: String,
    pub revision: u32,
    pub bookmarks: Vec<Bookmark>,
    pub tags: Vec<Tag>,
    pub collections: Vec<CollectionSource>,
    pub sync: SyncState,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum LibraryUpdate {
    Snapshot(LibrarySnapshot),
    Sync(SyncState),
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum BookmarkAction {
    Rename(String),
    Star(bool),
    Archive(bool),
    Read(bool),
    Delete,
    Tags(Vec<String>),
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReaderDocument {
    pub handle: String,
    pub page_id: String,
    pub url: String,
    pub bookmark_id: String,
    pub title: String,
    pub source_url: String,
    pub pdf: Option<PdfDocument>,
    pub progress: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PdfDocument {
    pub document_id: String,
    pub size: u32,
    pub filename: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub source: String,
    pub content: String,
    pub comment: String,
    pub kind: i32,
    pub metadata: String,
    pub approx_source: String,
    pub created_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub text: String,
    pub source: String,
    pub approx_source: String,
    pub rect: Rect,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub language: String,
    pub latest_n: u32,
    pub appearance: String,
    pub sidebar_width: u32,
    pub list_width: u32,
    pub sidebar_collapsed: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            language: "en".into(),
            latest_n: 50,
            appearance: "system".into(),
            sidebar_width: 232,
            list_width: 336,
            sidebar_collapsed: false,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemState {
    pub online: bool,
    pub expensive: bool,
    pub constrained: bool,
    pub sleeping: bool,
    pub reduce_transparency: bool,
    pub reduce_motion: bool,
    pub dark: bool,
}
impl Default for SystemState {
    fn default() -> Self {
        Self {
            online: true,
            expensive: false,
            constrained: false,
            sleeping: false,
            reduce_transparency: false,
            reduce_motion: false,
            dark: false,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AiChunk {
    pub request_id: String,
    pub text: String,
    pub replace: bool,
    pub takeaways: Option<Vec<String>>,
    pub done: bool,
    pub error: Option<String>,
}

pub fn typescript() -> String {
    let mut text = String::from("// Generated by slax-core. Run pnpm desktop -- ipc:generate.\n");
    macro_rules! decl {($($t:ty),*) => {$(text.push_str("export ");text.push_str(&<$t>::decl());text.push('\n');)*}}
    decl!(
        User,
        AuthState,
        BuildInfo,
        CoreError,
        Bookmark,
        Tag,
        CollectionSource,
        SyncState,
        LibrarySnapshot,
        LibraryUpdate,
        BookmarkAction,
        ReaderDocument,
        PdfDocument,
        Annotation,
        Selection,
        Rect,
        Preferences,
        SystemState,
        AiChunk,
        ShareSettings,
        Subscription,
        UpdateInfo
    );
    text
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ShareSettings {
    pub enabled: bool,
    pub show_line: bool,
    pub show_comment: bool,
    pub show_profile: bool,
    pub url: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub subscribed: bool,
    pub source: String,
    pub ends_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UpdateInfo {
    pub configured: bool,
    pub version: Option<String>,
}
