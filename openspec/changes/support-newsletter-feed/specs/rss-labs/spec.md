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
