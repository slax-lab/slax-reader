use crate::dto::{CoreError, Result, User};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;
use zeroize::{Zeroize, Zeroizing};
pub trait CredentialStore: Send + Sync {
    fn read(&self, key: &str) -> Result<Option<Zeroizing<String>>>;
    fn write(&self, key: &str, value: &str) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Session {
    pub token: String,
    pub expires_at: u64,
    pub user: User,
    pub api_origin: String,
}
impl Drop for Session {
    fn drop(&mut self) {
        self.token.zeroize()
    }
}
#[derive(Serialize, Deserialize)]
pub struct PendingLogin {
    verifier: String,
    state: String,
    created_at: u64,
    pub attempt: String,
    api_origin: String,
    web_origin: String,
    callback_scheme: String,
}
impl Drop for PendingLogin {
    fn drop(&mut self) {
        self.verifier.zeroize();
        self.state.zeroize()
    }
}
impl PendingLogin {
    pub fn is_current(&self, now: u64) -> bool {
        now >= self.created_at && now - self.created_at < 600
    }
    pub fn is_for(&self, api: &Url, web: &Url, scheme: &str) -> bool {
        self.api_origin == api.origin().ascii_serialization()
            && self.web_origin == web.origin().ascii_serialization()
            && self.callback_scheme == scheme
    }
    pub fn new(now: u64, api: &Url, web: &Url, scheme: &str) -> Self {
        Self {
            verifier: opaque(),
            state: opaque(),
            created_at: now,
            attempt: opaque(),
            api_origin: api.origin().ascii_serialization(),
            web_origin: web.origin().ascii_serialization(),
            callback_scheme: scheme.into(),
        }
    }
    pub fn browser_url(&self, web: &Url) -> Url {
        let mut u = web.join("/login").expect("validated origin");
        u.query_pairs_mut()
            .append_pair("client", "mac")
            .append_pair("code_challenge", &challenge(&self.verifier))
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &self.state);
        u
    }
    pub fn exchange(&self, raw: &str, now: u64) -> Result<serde_json::Value> {
        if now < self.created_at || now - self.created_at >= 600 {
            return Err(CoreError::new("LOGIN_EXPIRED"));
        }
        let u = Url::parse(raw).map_err(|_| CoreError::new("INVALID_CALLBACK"))?;
        if u.scheme() != self.callback_scheme
            || u.host_str() != Some("auth")
            || !u.username().is_empty()
            || u.password().is_some()
            || u.port().is_some()
            || !u.path().is_empty()
            || u.fragment().is_some()
        {
            return Err(CoreError::new("INVALID_CALLBACK"));
        }
        let p: Vec<_> = u.query_pairs().collect();
        if p.len() != 2
            || p.iter().filter(|(k, _)| k == "code").count() != 1
            || p.iter().filter(|(k, _)| k == "state").count() != 1
        {
            return Err(CoreError::new("INVALID_CALLBACK"));
        }
        let code = p.iter().find(|(k, _)| k == "code").unwrap().1.as_ref();
        let state = p.iter().find(|(k, _)| k == "state").unwrap().1.as_ref();
        if !opaque_valid(code) || state != self.state {
            return Err(CoreError::new("INVALID_CALLBACK"));
        }
        Ok(serde_json::json!({"code":code,"state":state,"code_verifier":self.verifier}))
    }
}
pub fn opaque() -> String {
    let mut b = [0u8; 32];
    rand::rng().fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}
pub fn challenge(v: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(v.as_bytes()))
}
pub fn opaque_valid(v: &str) -> bool {
    v.len() == 43
        && URL_SAFE_NO_PAD
            .decode(v)
            .is_ok_and(|b| b.len() == 32 && URL_SAFE_NO_PAD.encode(b) == v)
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn canonical_origin(raw: &str) -> Result<Url> {
    canonical_origin_with_loopback(raw, cfg!(debug_assertions))
}
pub fn canonical_origin_with_loopback(raw: &str, allow_loopback: bool) -> Result<Url> {
    let u = Url::parse(raw).map_err(|_| CoreError::new("INVALID_ORIGIN"))?;
    let local = allow_loopback && matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(u.scheme() == "https" || u.scheme() == "http" && local)
        || !u.username().is_empty()
        || u.password().is_some()
        || u.path() != "/"
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err(CoreError::new("INVALID_ORIGIN"));
    };
    Ok(u)
}
pub fn account_key(origin: &Url, id: &str) -> Result<String> {
    uuid::Uuid::parse_str(id).map_err(|_| CoreError::new("INVALID_ACCOUNT"))?;
    Ok(format!(
        "{:x}",
        Sha256::digest(format!("{}\n{id}", origin.origin().ascii_serialization()))
    ))
}
pub fn jwt_expiry(token: &str) -> Result<u64> {
    if token.len() > 16384 {
        return Err(CoreError::new("INVALID_CREDENTIAL"));
    };
    let b = URL_SAFE_NO_PAD
        .decode(
            token
                .split('.')
                .nth(1)
                .ok_or_else(|| CoreError::new("INVALID_CREDENTIAL"))?,
        )
        .map_err(|_| CoreError::new("INVALID_CREDENTIAL"))?;
    let v: serde_json::Value =
        serde_json::from_slice(&b).map_err(|_| CoreError::new("INVALID_CREDENTIAL"))?;
    v["exp"]
        .as_u64()
        .ok_or_else(|| CoreError::new("INVALID_CREDENTIAL"))
}
pub fn iso_expiry(raw: &str) -> Result<u64> {
    let timestamp = chrono::DateTime::parse_from_rfc3339(raw)
        .map(|date| date.timestamp())
        .or_else(|_| {
            // JavaScript ISO dates use signed six-digit years beyond year 9999.
            // Local session settings can produce these; the JWT expiry remains authoritative.
            chrono::NaiveDateTime::parse_from_str(
                raw.strip_suffix('Z').unwrap_or(""),
                "%Y-%m-%dT%H:%M:%S%.f",
            )
            .map(|date| date.and_utc().timestamp())
        })
        .map_err(|_| CoreError::new("INVALID_CREDENTIAL"))?;
    u64::try_from(timestamp).map_err(|_| CoreError::new("INVALID_CREDENTIAL"))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn pending(now: u64) -> PendingLogin {
        PendingLogin::new(
            now,
            &canonical_origin("https://api.example").unwrap(),
            &canonical_origin("https://web.example").unwrap(),
            "slaxreader-mac",
        )
    }
    #[test]
    fn pkce() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        )
    }
    #[test]
    fn callbacks() {
        let p = pending(100);
        let c = format!("slaxreader-mac://auth?code={}&state={}", opaque(), p.state);
        assert!(p.exchange(&c, 699).is_ok());
        assert!(p.exchange(&c, 700).is_err());
        assert!(p.exchange(&format!("{c}&code=x"), 101).is_err());
        assert!(
            p.exchange(&c.replace("://auth?", "://auth/?"), 101)
                .is_err()
        );
        assert!(pending(100).exchange(&c, 101).is_err())
    }
    #[test]
    fn accounts() {
        let a = canonical_origin("https://API.example:443").unwrap();
        assert_eq!(a.as_str(), "https://api.example/");
        assert!(account_key(&a, "../escape").is_err());
        let id = "8f181025-4004-42a4-a632-568342ad2caf";
        assert_ne!(
            account_key(&a, id).unwrap(),
            account_key(&canonical_origin("https://other.example").unwrap(), id).unwrap()
        );
        assert!(canonical_origin("https://api.example/private").is_err());
        assert!(canonical_origin("https://user:pass@api.example").is_err())
    }
}
