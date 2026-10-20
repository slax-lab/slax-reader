use powersync::CrudEntry;
use serde_json::{Map, Value, json};
fn strings(data: &Map<String, Value>) -> Map<String, Value> {
    data.iter()
        .map(|(k, v)| (k.clone(), if v.is_null() { Value::Null } else { string(v) }))
        .collect()
}
fn string(v: &Value) -> Value {
    Value::String(if let Some(s) = v.as_str() {
        s.into()
    } else {
        v.to_string()
    })
}
pub fn diff(
    data: Option<&Map<String, Value>>,
    previous: Option<&Map<String, Value>>,
) -> (Value, Value) {
    let Some(data) = data else {
        return (Value::Null, Value::Null);
    };
    let next = strings(data);
    let Some(previous) = previous else {
        return (Value::Object(next), Value::Null);
    };
    let prior = strings(previous);
    let mut changed = Map::new();
    let mut old = Map::new();
    for (key, value) in next {
        let before = prior.get(&key).cloned().unwrap_or(Value::Null);
        if value == before {
            continue;
        }
        if key == "metadata" {
            let a = value
                .as_str()
                .and_then(|s| serde_json::from_str::<Value>(s).ok());
            let b = before
                .as_str()
                .and_then(|s| serde_json::from_str::<Value>(s).ok());
            if let (Some(a), Some(b)) = (a, b)
                && a["tags"].is_array()
                && b["tags"].is_array()
                && a["bookmark"].is_object()
                && b["bookmark"].is_object()
            {
                if a["tags"] != b["tags"] {
                    changed.insert("metadata.tags".into(), string(&a["tags"]));
                    old.insert("metadata.tags".into(), string(&b["tags"]));
                }
                if a["share"].is_object() && b["share"].is_object() {
                    for f in [
                        "is_enable",
                        "show_line",
                        "show_comment",
                        "show_userinfo",
                        "share_code",
                        "created_at",
                    ] {
                        if a["share"][f] != b["share"][f] {
                            let k = format!("metadata.share.{f}");
                            changed.insert(k.clone(), string(&a["share"][f]));
                            old.insert(k, string(&b["share"][f]));
                        }
                    }
                } else if a["share"] != b["share"] {
                    changed.insert("metadata.share".into(), string(&a["share"]));
                    old.insert("metadata.share".into(), string(&b["share"]));
                }
                continue;
            }
        }
        changed.insert(key.clone(), value);
        old.insert(key, before);
    }
    (
        if changed.is_empty() {
            Value::Null
        } else {
            Value::Object(changed)
        },
        if old.is_empty() {
            Value::Null
        } else {
            Value::Object(old)
        },
    )
}
pub fn changes(entries: &[CrudEntry]) -> Vec<Value> {
    entries
        .iter()
        .map(|e| {
            let (data, prior) = diff(e.data.as_ref(), e.previous_values.as_ref());
            json!({"table":e.table,"id":e.id,"op":e.update_type,"data":data,"preData":prior})
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata() {
        let a = json!({"is_read":1,"metadata":json!({"tags":["a"],"bookmark":{},"share":null}).to_string()});
        let b = json!({"is_read":0,"metadata":json!({"tags":[],"bookmark":{},"share":null}).to_string()});
        let (n, p) = diff(a.as_object(), b.as_object());
        assert_eq!(n["is_read"], "1");
        assert_eq!(p["is_read"], "0");
        assert_eq!(n["metadata.tags"], "[\"a\"]");
    }
}
