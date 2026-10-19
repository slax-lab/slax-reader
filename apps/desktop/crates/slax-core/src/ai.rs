use crate::{auth, dto::*, runtime::Runtime};
use futures_util::StreamExt;
use reqwest::Method;
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tokio::time::Instant;

const FLUSH: Duration = Duration::from_millis(50);

impl Runtime {
    pub async fn ai(
        self: &Arc<Self>,
        generation: &str,
        handle: &str,
        kind: &str,
        force: bool,
        receive: Arc<dyn Fn(AiChunk) -> bool + Send + Sync>,
    ) -> Result<String> {
        if !["overview", "outline"].contains(&kind) {
            return Err(CoreError::new("INVALID_AI_KIND"));
        }
        let (a, id) = self.document_account(generation, handle).await?;
        a.bookmark(&id).await?;
        let request_id = auth::opaque();
        let cancel = a.document_cancel(handle)?.child_token();
        self.watches
            .lock()
            .await
            .insert(request_id.clone(), cancel.clone());
        let request = request_id.clone();
        let kind = kind.to_string();
        let handle = handle.to_string();
        let core = self.clone();
        tokio::spawn(async move {
            let _lease = a.lease.read().await;
            let mut content = String::new();
            let mut takeaways = Vec::new();
            let mut sent_takeaways = Vec::new();
            let outline = kind == "outline";
            let chunk = |text: String, takeaways: Option<Vec<String>>| AiChunk {
                request_id: request.clone(),
                text,
                replace: outline,
                takeaways,
                done: false,
                error: None,
            };
            let work = async {
                let local = a.local(&id).await?;
                if !force
                    && let Some(text) = local[&kind].as_str().filter(|s| !s.is_empty()) {
                        content = text.to_string();
                        receive(AiChunk {
                            replace: true,
                            ..chunk(content.clone(), None)
                        });
                        return Ok(());
                    }
                let token = a.token().await?;
                let r = a
                    .transport
                    .response(
                        &format!("/v1/bookmark/{kind}"),
                        Method::POST,
                        Some(&json!({"bookmark_uid":id,"force":force})),
                        Some(&token),
                        &cancel,
                        &[("Accept", "text/event-stream".into())],
                    )
                    .await?;
                let mut stream = r.bytes_stream();
                let mut buffer = Vec::new();
                let mut total = 0;
                let mut completed = false;
                // Overview text is appended; outline text replaces. Both are flushed at most every FLUSH.
                let mut pending = String::new();
                let mut dirty = false;
                let mut last = Instant::now() - FLUSH;
                let flush = |pending: &mut String,
                                 dirty: &mut bool,
                                 last: &mut Instant,
                                 content: &str,
                                 takeaways: &[String],
                                 sent: &mut Vec<String>|
                 -> Result<()> {
                    let text = if outline {
                        content.to_string()
                    } else {
                        std::mem::take(pending)
                    };
                    let changed = (sent.as_slice() != takeaways).then(|| takeaways.to_vec());
                    if let Some(value) = &changed {
                        sent.clone_from(value);
                    }
                    *dirty = false;
                    *last = Instant::now();
                    if !receive(chunk(text, changed)) {
                        return Err(CoreError::new("CANCELLED"));
                    }
                    Ok(())
                };
                loop {
                    let deadline = last + FLUSH;
                    let next = tokio::select! {
                        _ = cancel.cancelled() => return Err(CoreError::new("CANCELLED")),
                        _ = tokio::time::sleep_until(deadline), if dirty => {
                            flush(&mut pending, &mut dirty, &mut last, &content, &takeaways, &mut sent_takeaways)?;
                            continue;
                        }
                        c = stream.next() => c,
                    };
                    let Some(next) = next else { break };
                    let next = next.map_err(|_| CoreError::new("NETWORK_FAILED"))?;
                    total += next.len();
                    if total > 4 * 1024 * 1024 {
                        return Err(CoreError::new("RESPONSE_TOO_LARGE"));
                    }
                    buffer.extend_from_slice(&next);
                    while let Some(pos) = buffer.iter().position(|v| *v == b'\n') {
                        let line = buffer.drain(..=pos).collect::<Vec<_>>();
                        if line.iter().all(u8::is_ascii_whitespace) {
                            continue;
                        }
                        let value: Value = serde_json::from_slice(&line)
                            .map_err(|_| CoreError::new("AI_PROTOCOL_FAILED"))?;
                        a.document_id(&handle)?;
                        if value["type"] == "error" {
                            return Err(CoreError::new("AI_FAILED"));
                        }
                        if let Some(values) = value["data"]["key_takeaways"].as_array() {
                            takeaways = values
                                .iter()
                                .filter_map(|v| v.as_str().map(str::to_string))
                                .take(50)
                                .collect();
                            dirty = true;
                        }
                        let text = value["data"][kind.as_str()].as_str().unwrap_or("");
                        if outline {
                            if !text.is_empty() && text != content {
                                content = text.to_string();
                                dirty = true;
                            }
                        } else if !text.is_empty() {
                            content.push_str(text);
                            pending.push_str(text);
                            dirty = true;
                        }
                        if value["type"] == "done" || value["data"]["done"] == true {
                            completed = true;
                            break;
                        }
                    }
                    if completed {
                        break;
                    }
                    if dirty && last.elapsed() >= FLUSH {
                        flush(&mut pending, &mut dirty, &mut last, &content, &takeaways, &mut sent_takeaways)?;
                    }
                }
                if dirty {
                    flush(&mut pending, &mut dirty, &mut last, &content, &takeaways, &mut sent_takeaways)?;
                }
                if !completed {
                    return Err(CoreError::new("AI_INTERRUPTED"));
                }
                a.document_id(&handle)?;
                a.set_local(&id, json!({(kind.clone()):content,"key_takeaways":takeaways}))
                    .await?;
                Ok::<_, CoreError>(())
            }
            .await;
            if !cancel.is_cancelled() && a.document_id(&handle).is_ok() {
                receive(AiChunk {
                    request_id: request.clone(),
                    text: String::new(),
                    replace: false,
                    takeaways: (takeaways != sent_takeaways).then_some(takeaways),
                    done: true,
                    error: work.err().map(|e| e.code),
                });
            }
            core.watches.lock().await.remove(&request);
        });
        Ok(request_id)
    }
}
