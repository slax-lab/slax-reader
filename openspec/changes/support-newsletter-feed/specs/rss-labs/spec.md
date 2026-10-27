## MODIFIED Requirements

### Requirement: Web 在 Inbox 中显示 RSS 并保留列表缓存
Web SHALL always show a Feed entry immediately below Inbox and use the existing layout, search and list-mode components. Feed SHALL combine independently enabled RSS and Newsletter sources and retain the existing view=rss navigation link. Switching Feed and Inbox SHALL preserve list state. In RSS-only sessions with local data available, Web SHALL immediately render owned RSS sources and latest entries before a network round trip. With Newsletter enabled, the unified Feed SHALL read both kinds through REST. REST mode SHALL retain per-source lists, cursors and loaded pages until replacement succeeds. Logout SHALL clear user state; disabling a feature SHALL hide and clear that kind's session/body state while preserving the other enabled kind.

#### Scenario: 切换与刷新期间保留列表
- **WHEN** the user switches sources or returns from Inbox while refresh is in flight
- **THEN** cached enabled content remains visible and stale responses cannot override a newer source selection

#### Scenario: Reload with local data
- **WHEN** a user with Newsletter disabled and owned local RSS data reloads or opens offline
- **THEN** cached RSS subscriptions and entries are shown and network actions report existing network errors

#### Scenario: No feature enabled
- **WHEN** both RSS and Newsletter are disabled
- **THEN** Feed remains visible with setup guidance and does not reveal disabled content

## ADDED Requirements

### Requirement: RSS remains isolated from Newsletter
Existing RSS APIs, RSS synchronization, subscription limits, refresh/history leases, periodic polling and 30-day retention SHALL operate only on RSS-kind sources. Existing RSS DTOs and sync column projections SHALL remain compatible with older clients. Generic orphan cleanup SHALL include unsubscribed Newsletter sources and their entries; unreferenced R2 cleanup SHALL reclaim their bodies after the grace period. Physical source migration SHALL preserve legacy client table names and column projections. Newsletter admission SHALL remain disabled until every serving release sharing its database has this isolation.

#### Scenario: Legacy client reads and writes
- **WHEN** a user has RSS and Newsletter and uses an existing RSS endpoint or rss_v1 stream
- **THEN** only RSS data is returned and Newsletter resources cannot be refreshed, renamed, removed or saved through RSS endpoints

#### Scenario: Polling and quota
- **WHEN** scheduled RSS work or RSS subscription admission runs with Newsletter sources present
- **THEN** Newsletter URLs are never fetched and Newsletter sources do not consume the 20-source RSS allowance
