use crate::{dto::*, repository, runtime::Runtime};
use futures_util::{StreamExt, TryStreamExt};
use reqwest::Method;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

impl Runtime {
    pub async fn search(
        &self,
        generation: &str,
        view: &str,
        query: &str,
        cloud: bool,
        request_id: &str,
        tag_ids: &[String],
    ) -> Result<Vec<Bookmark>> {
        repository::identifier(request_id)?;
        repository::tag_values(tag_ids)?;
        let query = query.trim();
        if query.is_empty() || query.chars().count() > 500 {
            return Err(CoreError::new("INVALID_SEARCH"));
        }
        if !cloud {
            let a = self.account(generation).await?;
            let _lease = a.lease.read().await;
            return a.search_local(view, query, tag_ids).await;
        }
        let Some(cancel) = self.register(request_id, CancellationToken::new()).await else {
            return Err(CoreError::new("CANCELLED"));
        };
        let a = match self.account(generation).await {
            Ok(a) => a,
            Err(e) => {
                self.watches.lock().await.remove(request_id);
                return Err(e);
            }
        };
        let _lease = a.lease.read().await;
        let account_cancel = a.cancel.clone();
        let cancel_on_retire = cancel.clone();
        tokio::spawn(async move {
            tokio::select! {_=account_cancel.cancelled()=>cancel_on_retire.cancel(),_=cancel_on_retire.cancelled()=>{}}
        });
        let result = async {
            let known_tags = a.all_tags().await?;
            let token = a.token().await?;
            let data = a
                .transport
                .json(
                    "/v1/bookmark/search",
                    Method::POST,
                    Some(&json!({"keyword":query})),
                    Some(&token),
                    &cancel,
                )
                .await?;
            let items = data
                .as_array()
                .ok_or_else(|| CoreError::new("PROTOCOL_FAILED"))?;
            let mut ids = Vec::new();
            for item in items.iter().take(200) {
                let Some(id) = item["bookmark_user_uuid"].as_str() else {
                    continue;
                };
                repository::identifier(id)?;
                if !ids.iter().any(|v: &String| v == id) {
                    ids.push(id.to_string());
                }
            }
            let resolve = |id: String| {
                let (a, token, cancel, known_tags) = (&a, &token, &cancel, &known_tags);
                async move {
                    a.check()?;
                    if cancel.is_cancelled() {
                        return Err(CoreError::new("CANCELLED"));
                    }
                    match a.bookmark(&id).await {
                        Ok(bookmark) => Ok(bookmark),
                        Err(e) if e.code == "BOOKMARK_NOT_FOUND" => {
                            let data = a
                                .transport
                                .json(
                                    &format!("/v1/bookmark/metadata?bookmark_uid={id}"),
                                    Method::GET,
                                    None,
                                    Some(token),
                                    cancel,
                                )
                                .await?;
                            Ok(remote_bookmark(id, &data, known_tags))
                        }
                        Err(e) => Err(e),
                    }
                }
            };
            let rows = futures_util::stream::iter(ids)
                .map(resolve)
                .buffered(6)
                .try_filter(|bookmark| {
                    std::future::ready(tag_ids.iter().all(|tag| bookmark.tags.contains(tag)))
                })
                .try_collect::<Vec<_>>()
                .await?;
            a.check()?;
            if cancel.is_cancelled() {
                return Err(CoreError::new("CANCELLED"));
            }
            let open_ids = a
                .resources
                .lock()
                .unwrap()
                .documents
                .values()
                .map(|d| d.bookmark_id.clone())
                .collect::<std::collections::HashSet<_>>();
            let mut cache = a.remote_bookmarks.lock().unwrap();
            cache.retain(|id, _| open_ids.contains(id));
            for bookmark in &rows {
                cache.insert(bookmark.id.clone(), bookmark.clone());
            }
            Ok(rows)
        }
        .await;
        self.watches.lock().await.remove(request_id);
        cancel.cancel();
        result
    }
}
fn remote_bookmark(id: String, data: &Value, known_tags: &[Tag]) -> Bookmark {
    Bookmark {
        id,
        title: data["alias_title"]
            .as_str()
            .filter(|v| !v.is_empty())
            .or_else(|| data["title"].as_str())
            .unwrap_or("")
            .into(),
        url: data["target_url"].as_str().unwrap_or("").into(),
        description: data["description"].as_str().unwrap_or("").into(),
        created_at: data["created_at"].as_str().unwrap_or("").into(),
        owner_id: None,
        can_annotate: true,
        show_annotations: true,
        starred: false,
        archived: false,
        read: false,
        content_type: data["type"].as_i64().unwrap_or(0) as i32,
        tags: data["tags"]
            .as_array()
            .map(|tags| {
                tags.iter()
                    .filter_map(|tag| {
                        tag["name"]
                            .as_str()
                            .and_then(|name| known_tags.iter().find(|known| known.name == name))
                            .map(|known| known.id.clone())
                    })
                    .collect()
            })
            .unwrap_or_default(),
        downloaded: false,
        status: data["status"].as_str().unwrap_or("pending").into(),
    }
}
