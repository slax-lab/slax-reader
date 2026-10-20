use crate::{
    auth,
    dto::{CoreError, Result},
};
use futures_util::StreamExt;
use reqwest::{Client, Method, Response};
use serde_json::Value;
use std::{sync::RwLock, time::Duration};
use tokio_util::sync::CancellationToken;
use url::Url;
pub struct Transport {
    pub origin: Url,
    client: RwLock<Client>,
    images: RwLock<Client>,
}
struct PublicResolver;
impl reqwest::dns::Resolve for PublicResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addresses = tokio::net::lookup_host((host.as_str(), 0))
                .await?
                .collect::<Vec<_>>();
            if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
                return Err("RESOURCE_DENIED".into());
            }
            Ok(Box::new(addresses.into_iter()) as reqwest::dns::Addrs)
        })
    }
}
pub fn public_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v) => {
            !(v.is_private()
                || v.is_loopback()
                || v.is_link_local()
                || v.is_unspecified()
                || v.is_broadcast()
                || v.is_multicast()
                || v.octets()[0] == 0
                || v.octets()[0] >= 240
                || v.octets()[0] == 100 && (64..128).contains(&v.octets()[1])
                || v.octets()[0] == 169)
        }
        std::net::IpAddr::V6(v) => {
            if let Some(v) = v.to_ipv4_mapped() {
                return public_ip(v.into());
            };
            !v.is_loopback()
                && !v.is_unspecified()
                && !v.is_multicast()
                && (v.segments()[0] & 0xfe00) != 0xfc00
                && (v.segments()[0] & 0xffc0) != 0xfe80
        }
    }
}
impl Transport {
    pub fn new(origin: Url) -> Result<Self> {
        Ok(Self {
            origin,
            client: RwLock::new(Self::client()?),
            images: RwLock::new(Self::image_client()?),
        })
    }
    fn image_client() -> Result<Client> {
        Client::builder()
            .use_rustls_tls()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .pool_idle_timeout(Duration::from_secs(30))
            .dns_resolver(std::sync::Arc::new(PublicResolver))
            .build()
            .map_err(|_| CoreError::new("TRANSPORT_UNAVAILABLE"))
    }
    pub fn images(&self) -> Client {
        self.images.read().unwrap().clone()
    }
    fn client() -> Result<Client> {
        Client::builder()
            .use_rustls_tls()
            .user_agent(concat!("SlaxReader/macOS ", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| CoreError::new("TRANSPORT_UNAVAILABLE"))
    }
    pub fn refresh_proxy(&self) -> Result<()> {
        *self.client.write().unwrap() = Self::client()?;
        *self.images.write().unwrap() = Self::image_client()?;
        Ok(())
    }
    pub fn raw_client(&self) -> Client {
        self.client.read().unwrap().clone()
    }
    pub fn url(&self, path: &str) -> Result<Url> {
        if !path.starts_with('/') || path.starts_with("//") {
            return Err(CoreError::new("INVALID_PATH"));
        };
        let u = self
            .origin
            .join(path)
            .map_err(|_| CoreError::new("INVALID_PATH"))?;
        if u.origin() != self.origin.origin() {
            return Err(CoreError::new("INVALID_PATH"));
        };
        Ok(u)
    }
    pub async fn response(
        &self,
        path: &str,
        method: Method,
        body: Option<&Value>,
        token: Option<&str>,
        cancel: &CancellationToken,
        extra: &[(&str, String)],
    ) -> Result<Response> {
        let u = self.url(path)?;
        for attempt in 0..3 {
            if cancel.is_cancelled() {
                return Err(CoreError::new("CANCELLED"));
            }
            let mut r = self
                .raw_client()
                .request(method.clone(), u.clone())
                .header("Accept", "application/json")
                .header("X-CLIENT-TYPE", "macos")
                .header("X-CLIENT-VERSION", env!("CARGO_PKG_VERSION"));
            if path.starts_with("/v1/bookmark/pdf")
                || path.starts_with("/v1/bookmark/metadata")
                || path.starts_with("/v1/rss/")
            {
                r = r.timeout(Duration::from_secs(120));
            }
            if let Some(token) = token {
                if auth::jwt_expiry(token)? <= auth::now() {
                    return Err(CoreError::http(401));
                };
                r = r.bearer_auth(token)
            }
            if let Some(body) = body {
                r = r.json(body)
            }
            for (k, v) in extra {
                r = r.header(*k, v)
            }
            let result = tokio::select! {_=cancel.cancelled()=>return Err(CoreError::new("CANCELLED")),r=r.send()=>r};
            match result {
                Ok(r) if r.status().is_server_error() && attempt < 2 => {}
                Ok(r) => {
                    if !r.status().is_success() {
                        return Err(CoreError::http(r.status().as_u16()));
                    };
                    return Ok(r);
                }
                Err(_) if attempt >= 2 => return Err(CoreError::new("NETWORK_FAILED")),
                Err(_) => {}
            }
            tokio::select! {_=cancel.cancelled()=>return Err(CoreError::new("CANCELLED")),_=tokio::time::sleep(Duration::from_secs(1<<attempt))=>{}}
        }
        unreachable!()
    }
    pub async fn json(
        &self,
        path: &str,
        method: Method,
        body: Option<&Value>,
        token: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<Value> {
        let r = self
            .response(path, method, body, token, cancel, &[])
            .await?;
        if r.status() == 204 {
            return Ok(Value::Null);
        }
        let b = bounded(r, cancel, 4 * 1024 * 1024).await?;
        let v: Value = serde_json::from_slice(&b).map_err(|_| CoreError::new("PROTOCOL_FAILED"))?;
        if v["code"] != 200 {
            return Err(CoreError::http(
                v["code"]
                    .as_u64()
                    .and_then(|v| u16::try_from(v).ok())
                    .unwrap_or(502),
            ));
        }
        Ok(v["data"].clone())
    }
}
pub async fn bounded(r: Response, cancel: &CancellationToken, max: usize) -> Result<Vec<u8>> {
    if r.content_length().is_some_and(|v| v > max as u64) {
        return Err(CoreError::new("RESPONSE_TOO_LARGE"));
    }
    let mut data = Vec::new();
    let mut s = r.bytes_stream();
    loop {
        let c = tokio::select! {_=cancel.cancelled()=>return Err(CoreError::new("CANCELLED")),c=s.next()=>c};
        match c {
            None => break,
            Some(Err(_)) => return Err(CoreError::new("NETWORK_FAILED")),
            Some(Ok(b)) => {
                if data.len() + b.len() > max {
                    return Err(CoreError::new("RESPONSE_TOO_LARGE"));
                };
                data.extend_from_slice(&b)
            }
        }
    }
    Ok(data)
}
