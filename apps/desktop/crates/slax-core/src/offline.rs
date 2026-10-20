use crate::dto::{CoreError, Result};
use sha2::{Digest, Sha256};
use std::collections::{HashSet, VecDeque};
pub const PDF_MAX_BYTES: usize = 50 * 1024 * 1024;
pub fn cache_limit(v: u32) -> Result<Option<usize>> {
    match v {
        0 => Ok(None),
        30 | 50 | 100 | 200 => Ok(Some(v as usize)),
        _ => Err(CoreError::new("INVALID_CACHE_LIMIT")),
    }
}
#[derive(Default)]
pub struct Schedule {
    pub queue: VecDeque<String>,
    pub running: HashSet<String>,
    pub paused: bool,
}
impl Schedule {
    pub fn enqueue(&mut self, id: String) {
        if !self.running.contains(&id) && !self.queue.contains(&id) {
            self.queue.push_back(id)
        }
    }
    pub fn next_job(&mut self) -> Option<String> {
        if self.paused || self.running.len() >= 2 {
            return None;
        };
        let id = self.queue.pop_front()?;
        self.running.insert(id.clone());
        Some(id)
    }
    pub fn finish(&mut self, id: &str) {
        self.running.remove(id);
    }
}
pub fn validate_pdf(b: &[u8], id: &str, size: usize) -> Result<()> {
    if size == 0
        || size > PDF_MAX_BYTES
        || b.len() != size
        || !b.starts_with(b"%PDF-")
        || format!("{:x}", Sha256::digest(b)) != id
    {
        return Err(CoreError::new("PDF_IDENTITY_MISMATCH"));
    };
    Ok(())
}
pub fn range(begin: u32, end: u32, size: u32) -> Result<std::ops::Range<usize>> {
    if begin >= end || end > size || end - begin > 1024 * 1024 {
        return Err(CoreError::new("PDF_RANGE_INVALID"));
    };
    Ok(begin as usize..end as usize)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limits() {
        for v in [0, 30, 50, 100, 200] {
            assert!(cache_limit(v).is_ok())
        }
        assert!(cache_limit(31).is_err())
    }
    #[test]
    fn scheduling() {
        let mut s = Schedule::default();
        s.enqueue("a".into());
        s.enqueue("a".into());
        assert_eq!(s.next_job(), Some("a".into()));
        assert!(s.next_job().is_none());
        s.enqueue("a".into());
        assert!(s.queue.is_empty());
        s.paused = true;
        s.enqueue("b".into());
        assert!(s.next_job().is_none());
        s.paused = false;
        assert_eq!(s.next_job(), Some("b".into()))
    }
    #[test]
    fn integrity() {
        let b = b"%PDF-fixture";
        let id = format!("{:x}", Sha256::digest(b));
        assert!(validate_pdf(b, &id, b.len()).is_ok());
        assert!(validate_pdf(&b[..5], &id, b.len()).is_err());
        assert!(range(5, 4, 10).is_err())
    }
}
