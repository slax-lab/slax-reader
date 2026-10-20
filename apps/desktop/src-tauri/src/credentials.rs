use slax_core::{
    auth::CredentialStore,
    dto::{CoreError, Result},
};
use std::{fs, io::Write, path::PathBuf};
use zeroize::Zeroizing;

/// App-owned credentials, isolated by the selected environment and origin pair.
pub struct LocalCredentials {
    pub directory: PathBuf,
}
impl LocalCredentials {
    fn path(&self, key: &str) -> Result<PathBuf> {
        if !matches!(key, "session" | "pending") {
            return Err(CoreError::new("CREDENTIAL_FAILED"));
        }
        if let Ok(meta) = fs::symlink_metadata(&self.directory)
            && (!meta.is_dir() || meta.file_type().is_symlink())
        {
            return Err(CoreError::new("CREDENTIAL_FAILED"));
        }
        fs::create_dir_all(&self.directory).map_err(|_| CoreError::new("CREDENTIAL_FAILED"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.directory, fs::Permissions::from_mode(0o700))
                .map_err(|_| CoreError::new("CREDENTIAL_FAILED"))?;
        }
        let path = self.directory.join(key);
        if let Ok(meta) = fs::symlink_metadata(&path)
            && (!meta.is_file() || meta.file_type().is_symlink() || meta.len() > 256 * 1024)
        {
            return Err(CoreError::new("CREDENTIAL_FAILED"));
        }
        Ok(path)
    }
}
impl CredentialStore for LocalCredentials {
    fn read(&self, key: &str) -> Result<Option<Zeroizing<String>>> {
        let path = self.path(key)?;
        match fs::read_to_string(path) {
            Ok(value) => Ok(Some(Zeroizing::new(value))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(CoreError::new("CREDENTIAL_FAILED")),
        }
    }
    fn write(&self, key: &str, value: &str) -> Result<()> {
        let path = self.path(key)?;
        let temp = self
            .directory
            .join(format!(".{key}-{}", slax_core::auth::opaque()));
        let result = (|| -> std::io::Result<()> {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temp)?;
            file.write_all(value.as_bytes())?;
            file.sync_all()?;
            fs::rename(&temp, &path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result.map_err(|_| CoreError::new("CREDENTIAL_FAILED"))
    }
    fn delete(&self, key: &str) -> Result<()> {
        match fs::remove_file(self.path(key)?) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(CoreError::new("CREDENTIAL_FAILED")),
        }
    }
}
