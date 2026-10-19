use crate::{account::Account, dto::*};
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};
use uuid::Uuid;
pub fn identifier(id: &str) -> Result<()> {
    Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| CoreError::new("INVALID_ID"))
}
fn bookmark(row: &rusqlite::Row<'_>) -> rusqlite::Result<Bookmark> {
    let metadata: String = row.get(3)?;
    let m: Value = serde_json::from_str(&metadata).unwrap_or(Value::Null);
    let alias: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
    Ok(Bookmark {
        id: row.get(0)?,
        title: if alias.is_empty() {
            m["bookmark"]["title"].as_str().unwrap_or("").into()
        } else {
            alias
        },
        url: m["bookmark"]["target_url"].as_str().unwrap_or("").into(),
        description: m["bookmark"]["description"].as_str().unwrap_or("").into(),
        created_at: row.get(2)?,
        starred: row.get::<_, Option<i32>>(4)?.unwrap_or(0) == 1,
        archived: row.get::<_, Option<i32>>(5)?.unwrap_or(0) == 1,
        read: row.get::<_, Option<i32>>(6)?.unwrap_or(0) == 1,
        content_type: row.get::<_, Option<i32>>(7)?.unwrap_or(0),
        tags: m["tags"]
            .as_array()
            .map(|v| {
                v.iter()
                    .filter_map(|s| s.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        downloaded: row.get::<_, i32>(8)? == 2,
        status: m["bookmark"]["status"].as_str().unwrap_or("pending").into(),
        owner_id: None,
        can_annotate: true,
        show_annotations: true,
    })
}
const COLUMNS: &str = "b.id,b.alias_title,b.created_at,coalesce(b.metadata,'{}'),b.is_starred,b.archive_status,b.is_read,b.type,coalesce(json_extract(l.data,'$.is_downloaded'),0)";
const TAG_FILTER: &str = "NOT EXISTS(SELECT 1 FROM json_each(:tags) wanted WHERE NOT EXISTS(SELECT 1 FROM json_each(coalesce(json_extract(b.metadata,'$.tags'),'[]')) actual WHERE actual.value=wanted.value))";
pub fn tag_values(tags: &[String]) -> Result<String> {
    if tags.len() > 100 {
        return Err(CoreError::new("TOO_MANY_TAGS"));
    }
    for tag in tags {
        identifier(tag)?;
    }
    Ok(json!(tags).to_string())
}
const COLLECTION_COLUMNS: &str = "b.id,b.alias_title,b.created_at,coalesce(b.metadata,'{}'),1,0,0,CASE json_extract(b.metadata,'$.bookmark.type') WHEN 'pdf' THEN 2 WHEN 'shortcut' THEN 1 ELSE coalesce(CAST(json_extract(b.metadata,'$.bookmark.type') AS INTEGER),0) END,coalesce(json_extract(l.data,'$.is_downloaded'),0),b.owner_id,coalesce(settings.allow_highlight,0),coalesce(settings.show_highlight,0),coalesce(settings.allow_access,0)";
const COLLECTION_FROM: &str = "sr_collection_bookmark b LEFT JOIN ps_data_local__local_bookmark_info l ON l.id=b.id LEFT JOIN sr_sharer_setting settings ON settings.id=b.owner_id";
const COLLECTION_ACCESS: &str = "EXISTS(SELECT 1 FROM sr_user_collection_subscriber s JOIN sr_user_collection c ON c.id=s.collection_id WHERE c.owner_id=b.owner_id AND c.status=1 AND julianday(s.subscription_end_time)>julianday('now'))";
fn collection_bookmark(row: &rusqlite::Row<'_>) -> rusqlite::Result<Bookmark> {
    let mut value = bookmark(row)?;
    value.owner_id = Some(row.get(9)?);
    value.can_annotate = row.get::<_, i32>(10)? == 1 && row.get::<_, i32>(12)? == 1;
    value.show_annotations = row.get::<_, i32>(11)? == 1 && row.get::<_, i32>(12)? == 1;
    Ok(value)
}
impl Account {
    pub async fn library(
        &self,
        view: &str,
        tag_ids: &[String],
    ) -> Result<(Vec<Bookmark>, Vec<Tag>)> {
        self.check()?;
        if let Some(id) = view.strip_prefix("collection:") {
            return Ok((
                self.collection_rows(id, "", tag_ids).await?,
                self.all_tags().await?,
            ));
        }
        let tags_json = tag_values(tag_ids)?;
        let filter = match view {
            "inbox" => "b.archive_status=0",
            "starred" => "b.is_starred=1",
            "archived" => "b.archive_status=1",
            _ => return Err(CoreError::new("INVALID_VIEW")),
        };
        let c = self.db.reader().await?;
        self.check()?;
        let mut stmt=c.prepare(&format!("SELECT {COLUMNS} FROM sr_user_bookmark b LEFT JOIN ps_data_local__local_bookmark_info l ON l.id=b.id WHERE b.deleted_at IS NULL AND {filter} AND {TAG_FILTER} ORDER BY b.created_at DESC LIMIT 2000"))?;
        let rows = stmt
            .query_map([tags_json], bookmark)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let tags = c
            .prepare("SELECT id,tag_name FROM sr_user_tag ORDER BY tag_name")?
            .query_map([], |r| {
                Ok(Tag {
                    id: r.get(0)?,
                    name: r.get(1)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((rows, tags))
    }
    pub async fn all_tags(&self) -> Result<Vec<Tag>> {
        let c = self.db.reader().await?;
        self.check()?;
        Ok(
            c.prepare("SELECT id,tag_name FROM sr_user_tag ORDER BY tag_name")?
                .query_map([], |r| {
                    Ok(Tag {
                        id: r.get(0)?,
                        name: r.get(1)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?,
        )
    }
    pub async fn collections(&self) -> Result<Vec<CollectionSource>> {
        let c = self.db.reader().await?;
        self.check()?;
        let mut stmt = c.prepare("SELECT c.id,coalesce(c.display_name,''),c.owner_id,coalesce(c.status=1 AND julianday(s.subscription_end_time)>julianday('now'),0) FROM sr_user_collection_subscriber s JOIN sr_user_collection c ON c.id=s.collection_id ORDER BY s.created_at,c.id")?;
        Ok(stmt
            .query_map([], |r| {
                Ok(CollectionSource {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    owner_id: r.get(2)?,
                    available: r.get::<_, i32>(3)? == 1,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?)
    }
    pub async fn collection_rows(
        &self,
        id: &str,
        query: &str,
        tag_ids: &[String],
    ) -> Result<Vec<Bookmark>> {
        identifier(id)?;
        let tags_json = tag_values(tag_ids)?;
        let sources = self.collections().await?;
        let source = sources
            .iter()
            .find(|v| v.id == id)
            .ok_or_else(|| CoreError::new("COLLECTION_UNAVAILABLE"))?;
        if !source.available {
            return Err(CoreError::new("COLLECTION_UNAVAILABLE"));
        }
        let c = self.db.reader().await?;
        self.check()?;
        let mut stmt = c.prepare(&format!("SELECT {COLLECTION_COLUMNS} FROM {COLLECTION_FROM} WHERE b.owner_id=?1 AND {COLLECTION_ACCESS} AND instr(lower(coalesce(b.alias_title,'') || ' ' || coalesce(json_extract(b.metadata,'$.bookmark.title'),'') || ' ' || coalesce(json_extract(b.metadata,'$.bookmark.description'),'')),lower(?2))>0 AND {TAG_FILTER} ORDER BY coalesce(nullif(b.starred_at,''),b.created_at) DESC LIMIT 2000"))?;
        Ok(stmt
            .query_map(
                params![source.owner_id, query, tags_json],
                collection_bookmark,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?)
    }
    pub async fn bookmark(&self, id: &str) -> Result<Bookmark> {
        identifier(id)?;
        self.check()?;
        let c = self.db.reader().await?;
        self.check()?;
        if let Some(value) = c.query_row(&format!("SELECT {COLUMNS} FROM sr_user_bookmark b LEFT JOIN ps_data_local__local_bookmark_info l ON l.id=b.id WHERE b.id=?1 AND b.deleted_at IS NULL"),[id],bookmark).optional()? { return Ok(value); }
        if let Some(value) = c.query_row(&format!("SELECT {COLLECTION_COLUMNS} FROM {COLLECTION_FROM} WHERE b.id=?1 AND {COLLECTION_ACCESS}"),[id],collection_bookmark).optional()? { return Ok(value); }
        self.remote_bookmarks
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| CoreError::new("BOOKMARK_NOT_FOUND"))
    }
    pub async fn search_local(
        &self,
        view: &str,
        query: &str,
        tag_ids: &[String],
    ) -> Result<Vec<Bookmark>> {
        self.check()?;
        if let Some(id) = view.strip_prefix("collection:") {
            return self.collection_rows(id, query, tag_ids).await;
        }
        let tags_json = tag_values(tag_ids)?;
        let filter = match view {
            "inbox" => "b.archive_status=0",
            "starred" => "b.is_starred=1",
            "archived" => "b.archive_status=1",
            _ => return Err(CoreError::new("INVALID_VIEW")),
        };
        let c = self.db.reader().await?;
        self.check()?;
        let mut stmt = c.prepare(&format!("SELECT {COLUMNS} FROM sr_user_bookmark b LEFT JOIN ps_data_local__local_bookmark_info l ON l.id=b.id WHERE b.deleted_at IS NULL AND {filter} AND (instr(lower(coalesce(b.alias_title,'') || ' ' || coalesce(json_extract(b.metadata,'$.bookmark.title'),'') || ' ' || coalesce(json_extract(b.metadata,'$.bookmark.target_url'),'') || ' ' || coalesce(json_extract(b.metadata,'$.bookmark.description'),'')), lower(?1))>0) AND {TAG_FILTER} ORDER BY b.created_at DESC LIMIT 2000"))?;
        let rows = stmt
            .query_map(params![query, tags_json], bookmark)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        self.check()?;
        Ok(rows)
    }
    pub async fn add_url(&self, url: &str) -> Result<String> {
        let u = external_url(url)?;
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let m = json!({"tags":[],"bookmark":{"uuid":id,"title":url,"byline":"","status":"pending","host_url":u.origin().ascii_serialization(),"site_name":"","target_url":u.as_str(),"description":"","content_icon":"","published_at":now,"content_cover":"","content_word_count":0}});
        let user = self.session.lock().await.user.uuid.clone();
        self.check()?;
        let c = self.db.writer().await?;
        self.check()?;
        c.execute("INSERT INTO sr_user_bookmark (id,user_id,is_read,archive_status,is_starred,created_at,updated_at,alias_title,type,deleted_at,metadata) VALUES (?1,?2,0,0,0,?3,?3,'',0,NULL,?4)",params![id,user,now,m.to_string()])?;
        Ok(id)
    }
    pub async fn mutate(&self, id: &str, action: BookmarkAction) -> Result<()> {
        if self.bookmark(id).await?.owner_id.is_some() {
            return Err(CoreError::new("FORBIDDEN"));
        }
        let c = self.db.writer().await?;
        self.check()?;
        match action {
            BookmarkAction::Rename(title) => {
                if title.chars().count() > 500 {
                    return Err(CoreError::new("TITLE_TOO_LONG"));
                };
                c.execute(
                    "UPDATE sr_user_bookmark SET alias_title=?1 WHERE id=?2",
                    params![title, id],
                )?;
            }
            BookmarkAction::Star(value) => {
                c.execute(
                    "UPDATE sr_user_bookmark SET is_starred=?1,starred_at=?2 WHERE id=?3",
                    params![value, chrono::Utc::now().to_rfc3339(), id],
                )?;
            }
            BookmarkAction::Archive(value) => {
                c.execute(
                    "UPDATE sr_user_bookmark SET archive_status=?1,archived_at=?2 WHERE id=?3",
                    params![value, chrono::Utc::now().to_rfc3339(), id],
                )?;
            }
            BookmarkAction::Read(value) => {
                c.execute(
                    "UPDATE sr_user_bookmark SET is_read=?1 WHERE id=?2",
                    params![value, id],
                )?;
            }
            BookmarkAction::Delete => {
                c.execute(
                    "UPDATE sr_user_bookmark SET deleted_at=?1 WHERE id=?2",
                    params![chrono::Utc::now().to_rfc3339(), id],
                )?;
                self.resources
                    .lock()
                    .unwrap()
                    .documents
                    .retain(|_, document| document.bookmark_id != id);
            }
            BookmarkAction::Tags(tags) => {
                if tags.len() > 100 {
                    return Err(CoreError::new("TOO_MANY_TAGS"));
                }
                for t in &tags {
                    identifier(t)?;
                    let exists: bool = c.query_row(
                        "SELECT EXISTS(SELECT 1 FROM sr_user_tag WHERE id=?1)",
                        [t],
                        |r| r.get(0),
                    )?;
                    if !exists {
                        return Err(CoreError::new("INVALID_TAG"));
                    }
                }
                c.execute("UPDATE sr_user_bookmark SET metadata=json_set(coalesce(metadata,'{}'),'$.tags',json(?1)) WHERE id=?2",params![json!(tags).to_string(),id])?;
            }
        }
        Ok(())
    }
    pub async fn create_tag(&self, name: &str) -> Result<String> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(CoreError::new("INVALID_TAG"));
        };
        let id = Uuid::new_v4().to_string();
        let c = self.db.writer().await?;
        self.check()?;
        c.execute("INSERT INTO sr_user_tag (id,tag_name,display,source,created_at) VALUES (?1,?2,'1','mine',?3)",params![id,name,chrono::Utc::now().to_rfc3339()])?;
        Ok(id)
    }
    pub async fn local(&self, id: &str) -> Result<Value> {
        identifier(id)?;
        let c = self.db.reader().await?;
        self.check()?;
        let data: Option<String> = c
            .query_row(
                "SELECT data FROM ps_data_local__local_bookmark_info WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        Ok(data
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(json!({})))
    }
    pub async fn set_local(&self, id: &str, fields: Value) -> Result<()> {
        let mut c = self.db.writer().await?;
        self.check()?;
        let tx = c.transaction()?;
        let data: Option<String> = tx
            .query_row(
                "SELECT data FROM ps_data_local__local_bookmark_info WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        let mut v: Value = data
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(json!({}));
        for (k, value) in fields
            .as_object()
            .ok_or_else(|| CoreError::new("INVALID_LOCAL_DATA"))?
        {
            v[k] = value.clone()
        }
        tx.execute("INSERT INTO ps_data_local__local_bookmark_info (id,data) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![id,v.to_string()])?;
        tx.commit()?;
        Ok(())
    }
    pub async fn annotations(&self, id: &str) -> Result<Vec<Annotation>> {
        if !self.bookmark(id).await?.show_annotations {
            return Ok(Vec::new());
        }
        let c = self.db.reader().await?;
        self.check()?;
        Ok(c.prepare("SELECT id,coalesce(source,''),coalesce(content,''),coalesce(comment,''),type,coalesce(metadata,'{}'),created_at,coalesce(approx_source,'{}') FROM sr_bookmark_comment WHERE user_bookmark_uuid=?1 AND is_deleted=0 ORDER BY created_at")?.query_map([id],|r|Ok(Annotation{id:r.get(0)?,source:r.get(1)?,content:r.get(2)?,comment:r.get(3)?,kind:r.get(4)?,metadata:r.get(5)?,created_at:r.get(6)?,approx_source:r.get(7)?}))?.collect::<std::result::Result<Vec<_>,_>>()?)
    }
    pub async fn add_mark(
        &self,
        id: &str,
        kind: i32,
        selection: Option<Selection>,
        comment: &str,
        parent: Option<&str>,
    ) -> Result<String> {
        let bookmark = self.bookmark(id).await?;
        if !bookmark.can_annotate {
            return Err(CoreError::new("MARK_PERMISSION_DENIED"));
        }
        if !(1..=3).contains(&kind)
            || comment.len() > 20000
            || kind == 1 && selection.is_none()
            || kind != 1 && comment.trim().is_empty()
            || (kind == 3) != parent.is_some()
        {
            return Err(CoreError::new("INVALID_MARK"));
        };
        let mut source = String::new();
        let mut content = "[]".to_string();
        let mut approx = String::new();
        if let Some(s) = selection {
            if s.text.len() > 100000 || s.source.len() > 100000 || s.approx_source.len() > 100000 {
                return Err(CoreError::new("INVALID_MARK"));
            };
            let v: Value =
                serde_json::from_str(&s.source).map_err(|_| CoreError::new("INVALID_MARK"))?;
            let local = self.local(id).await?;
            source = validate_selection(
                &s,
                v,
                bookmark.content_type,
                local["pdf"]["documentId"].as_str(),
            )?
            .to_string();
            content = json!([{"type":"text","text":s.text,"src":""}]).to_string();
            approx = s.approx_source;
        }
        let mark = Uuid::new_v4().to_string();
        let user = self.session.lock().await.user.uuid.clone();
        let c = self.db.writer().await?;
        self.check()?;
        let mut root = parent.map(str::to_owned);
        if let Some(p) = parent {
            identifier(p)?;
            let metadata: String = c.query_row("SELECT coalesce(metadata,'{}') FROM sr_bookmark_comment WHERE id=?1 AND user_bookmark_uuid=?2 AND is_deleted=0", params![p,id], |r| r.get(0)).optional()?.ok_or_else(|| CoreError::new("INVALID_REPLY"))?;
            let metadata: Value =
                serde_json::from_str(&metadata).map_err(|_| CoreError::new("INVALID_REPLY"))?;
            if let Some(existing) = metadata["root_id"].as_str().filter(|v| !v.is_empty()) {
                identifier(existing)?;
                root = Some(existing.into());
            }
        }
        c.execute("INSERT INTO sr_bookmark_comment (id,type,source,user_bookmark_uuid,comment,approx_source,content,is_deleted,created_at,metadata) VALUES (?1,?2,?3,?4,?5,?6,?7,0,?8,?9)",params![mark,kind,source,id,comment,approx,content,chrono::Utc::now().to_rfc3339(),json!({"root_id":root,"parent_id":parent,"user_id":user,"source_type":bookmark.owner_id.as_ref().map(|_|"collection"),"source_id":bookmark.owner_id.as_ref().map(|_|id),"bookmark_id":id}).to_string()])?;
        Ok(mark)
    }
    pub async fn delete_mark(&self, id: &str, mark: &str) -> Result<()> {
        if !self.bookmark(id).await?.show_annotations {
            return Err(CoreError::new("MARK_PERMISSION_DENIED"));
        }
        identifier(mark)?;
        let user = self.session.lock().await.user.uuid.clone();
        let c = self.db.writer().await?;
        self.check()?;
        let owner:Option<String>=c.query_row("SELECT json_extract(metadata,'$.user_id') FROM sr_bookmark_comment WHERE id=?1 AND user_bookmark_uuid=?2",params![mark,id],|r|r.get(0)).optional()?.flatten();
        if owner.as_deref() != Some(&user) {
            return Err(CoreError::new("MARK_PERMISSION_DENIED"));
        };
        c.execute(
            "UPDATE sr_bookmark_comment SET is_deleted=1 WHERE id=?1",
            [mark],
        )?;
        Ok(())
    }
}
fn validate_selection(
    selection: &Selection,
    value: Value,
    content_type: i32,
    document: Option<&str>,
) -> Result<Value> {
    let invalid = || CoreError::new("INVALID_MARK");
    let sources = value
        .as_array()
        .filter(|v| !v.is_empty() && v.len() <= 1000)
        .ok_or_else(invalid)?;
    let rect = &selection.rect;
    if selection.text.trim().is_empty()
        || ![rect.x, rect.y, rect.width, rect.height]
            .iter()
            .all(|n| n.is_finite() && n.abs() <= 1e7)
        || rect.width < 0.0
        || rect.height < 0.0
    {
        return Err(invalid());
    }
    let approx: Value = serde_json::from_str(&selection.approx_source).map_err(|_| invalid())?;
    if !approx.is_object() {
        return Err(invalid());
    }
    let mut normalized = Vec::with_capacity(sources.len());
    for item in sources {
        let kind = item["type"].as_str().ok_or_else(invalid)?;
        if content_type == 2 {
            let page = item["page"]
                .as_u64()
                .filter(|p| (1..=100000).contains(p))
                .ok_or_else(invalid)?;
            let doc = item["document_id"].as_str().ok_or_else(invalid)?;
            if kind != "pdf"
                || item["version"] != 1
                || Some(doc) != document
                || !item["text"]
                    .as_str()
                    .is_some_and(|s| !s.trim().is_empty() && s.len() <= 100000)
            {
                return Err(invalid());
            }
            let quads = item["quads"]
                .as_array()
                .filter(|q| !q.is_empty() && q.len() <= 10000)
                .ok_or_else(invalid)?;
            for quad in quads {
                if !quad.as_array().is_some_and(|q| {
                    q.len() == 8
                        && q.iter()
                            .all(|n| n.as_f64().is_some_and(|n| n.is_finite() && n.abs() <= 1e7))
                }) {
                    return Err(invalid());
                }
            }
            normalized.push(json!({"type":"pdf","version":1,"page":page,"document_id":doc,"text":item["text"],"quads":quads}));
        } else {
            if !["text", "image"].contains(&kind) {
                return Err(invalid());
            }
            let path = item
                .get("path")
                .or_else(|| item.get("xpath"))
                .and_then(Value::as_str)
                .filter(|p| !p.is_empty() && p.len() <= 4096 && !p.contains('\0'))
                .ok_or_else(invalid)?;
            if kind == "text" {
                let start = item
                    .get("start")
                    .or_else(|| item.get("start_offset"))
                    .and_then(Value::as_u64)
                    .filter(|n| *n <= i32::MAX as u64)
                    .ok_or_else(invalid)?;
                let end = item
                    .get("end")
                    .or_else(|| item.get("end_offset"))
                    .and_then(Value::as_u64)
                    .filter(|n| *n > start && *n <= i32::MAX as u64)
                    .ok_or_else(invalid)?;
                normalized.push(json!({"type":kind,"path":path,"start":start,"end":end}));
            } else {
                normalized.push(json!({"type":kind,"path":path}));
            }
        }
    }
    Ok(json!(normalized))
}
pub fn external_url(raw: &str) -> Result<url::Url> {
    if raw.len() > 8192 {
        return Err(CoreError::new("INVALID_URL"));
    }
    let u = url::Url::parse(raw).map_err(|_| CoreError::new("INVALID_URL"))?;
    if !matches!(u.scheme(), "https" | "http")
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return Err(CoreError::new("INVALID_URL"));
    };
    Ok(u)
}
