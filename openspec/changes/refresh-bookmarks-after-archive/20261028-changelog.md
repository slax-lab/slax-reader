# Bookmark archive refresh

- The reader now notifies other tabs after successful archive and unarchive actions.
- The notification includes the account identity and bookmark UUID. Failed or obsolete actions do not publish successful changes.
- Personal bookmark lists recheck data on foreground return and cached-page activation.
- REST refreshes retain displayed rows until all loaded pages are ready. Local refreshes only read the database.
- A later account, filter, or archive action invalidates an older refresh response.
- Refresh failures retain the list and permit recovery on the next return.
- No application package version changes are required. This change affects Web only.
