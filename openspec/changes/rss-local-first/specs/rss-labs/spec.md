# Spec Delta

## MODIFIED Requirements

### Requirement: Web 在 Inbox 中显示 RSS 并保留列表缓存

Web SHALL 在 Inbox 侧栏紧接 Inbox 下方显示已启用的 RSS 入口，复用现有页面布局、搜索与列表模式切换组件。切换 RSS 与 Inbox SHALL 保留各自的列表状态，不重新挂载整个页面。When the local database is available, Web SHALL render subscriptions and latest entries from the local-first RSS list data, and the list SHALL survive reloads and be visible without a network round trip. When the local database is unavailable, RSS SHALL 按来源保存当前会话的列表、分页游标及已加载页数；定时检查和手动重新加载 SHALL 保留旧列表直到新数据成功返回，失败保留旧缓存。退出账号或关闭功能 SHALL 清除缓存。

#### Scenario: 切换与刷新期间保留列表
- **WHEN** 用户切换来源、切回 Inbox，或者定时和手动更新 RSS 列表
- **THEN** 已缓存列表立即可见，更新期间不清空列表，过期响应不会覆盖后来选择的来源

#### Scenario: Reload with local data
- **WHEN** a user with local RSS data reloads the page or opens it while offline
- **THEN** the subscriptions and latest entries are shown from local data; article detail, add, rename, remove, refresh and save report the existing network errors instead of silently failing

### Requirement: 按需混合读取历史
系统 SHALL 定时更新最新页，普通列表查询 SHALL 只读共享缓存。显式 fetch_history=1 的 Load more 请求在当前游标后缓存不足一页时 SHALL 沿源提供的 next 或 prev-archive 链接补抓、共享保存并重新查询。一次请求 SHALL 最多补抓三个源，每源一页历史，旧订阅允许额外读取最新页发现历史入口。共享租约 SHALL 排除并发重复抓取，历史修订 SHALL 不覆盖已缓存的新版本。历史抓取 SHALL 保留 URL 校验、内容净化和图片缓存流程。A list request MAY identify its position with an entry id the user is authorized to read instead of an opaque cursor; the first response SHALL contain, in timeline order, the entries after that entry plus any history entries newer than it that local synchronization does not deliver, and each entry SHALL carry its timeline position so clients can merge it with local rows. An unknown or unauthorized entry SHALL be rejected without revealing whether it exists.

#### Scenario: 最新页只有十条且有历史入口
- **WHEN** 用户点击 Load more 且缓存已读完
- **THEN** 服务端抓取一页历史并保存，客户端从头重新校验已展开窗口，保持时间顺序且不重复条目

#### Scenario: 源没有提供历史或暂时失败
- **WHEN** 历史链接已耗尽或请求失败
- **THEN** 响应 SHALL 区分耗尽与可重试状态；耗尽时隐藏 Load more，失败保留缓存及进度并至少冷却 60 秒且尊重 Retry-After

#### Scenario: 自动列表检查
- **WHEN** 客户端定时校验缓存窗口
- **THEN** 请求不包含 fetch_history，不触发源站历史抓取，只有所有缓存页成功返回后才替换现有列表

#### Scenario: Continue after a local entry
- **WHEN** a client whose list is rendered from local data requests more entries after its last local entry
- **THEN** the client shows, in one timeline without duplicates or gaps, the local entries and the returned entries, including history entries of another feed that are newer than the requested position, and an explicit history request follows the same history rules

## ADDED Requirements

### Requirement: Local-first RSS list data

Web and the native app SHALL keep the user's RSS subscriptions, the metadata of their subscribed feeds, and each subscribed feed's latest-page entries in their local database while the RSS laboratory is enabled. Only clients that explicitly request this data SHALL receive it; existing clients SHALL keep their current behavior. The server SHALL deliver the data only to authenticated, non-deleted accounts with the RSS laboratory enabled, SHALL deliver a subscription row only to its owner, and SHALL deliver shared feed and entry rows only to users subscribed to that feed. Article HTML, fetch validators, lease tokens and entries obtained from history pages SHALL NOT be delivered through local synchronization. Display names, refresh state and saved state SHALL be derived on the client from the delivered rows and the user's local bookmarks. Changes to the shared cache SHALL be delivered only when a delivered field changes.

#### Scenario: Enabled user opens RSS on a new client
- **WHEN** a user with the RSS laboratory enabled opens RSS on a client that supports local RSS data
- **THEN** the client shows a loading state until the first local synchronization and local queries complete, then shows the same subscriptions and latest entries as the REST API without an empty-state flash; initialization, source selection and automatic checks do not request REST subscription or entry lists while synchronization is pending

#### Scenario: Shared feed does not leak other subscribers
- **WHEN** two users subscribe to the same feed with different display names
- **THEN** each user's local data contains the shared feed and its entries but only their own subscription and display name

#### Scenario: Laboratory disabled or account deleted
- **WHEN** the RSS laboratory is disabled for the user, or the account is deleted, while a client is connected
- **THEN** the local RSS subscriptions, feeds and entries are removed from that client without requiring a reconnect, and bookmarks created from RSS remain

#### Scenario: Older client
- **WHEN** a client version without local RSS support connects
- **THEN** it receives no RSS rows and its RSS experience behaves as before

#### Scenario: Write while local data is pending
- **WHEN** the user adds, renames, removes, refreshes or saves through the existing endpoints
- **THEN** the client reflects the confirmed server result immediately and converges with local data once synchronization delivers it, without duplicating or resurrecting rows

#### Scenario: Native database created before local RSS
- **WHEN** a native installation whose local database predates the RSS tables is upgraded
- **THEN** the app opens its existing database without recovery or data loss and starts receiving local RSS data

#### Scenario: Fresh React Native database reaches synchronization
- **WHEN** the current SDK initializes a native-created format-14 database with SQLite `user_version=0`, or reopens that verified installation
- **THEN** the app admits the database after checking its exact supported tables, canonical location and owner, without resetting it or rewriting its version marker; Kotlin-adopted databases continue to require `user_version=1`

#### Scenario: Native All view has no empty source-action row
- **WHEN** the native user views all RSS sources without selecting a subscription
- **THEN** the first article follows the source strip with normal row padding and no empty source-action toolbar; selecting a subscription restores its refresh and menu controls with their existing hit areas

#### Scenario: Cached native list while network readiness is pending
- **WHEN** the native client has admitted local RSS data and its stream or Labs request is pending or fails due to network unavailability
- **THEN** the client shows its cached list and permits local source selection without waiting for that network work; a confirmed later disabled Labs response clears the list, and stale responses after cancellation or account replacement cannot alter the active account

#### Scenario: Save synchronization precedes its REST response
- **WHEN** a save has already synchronized before its REST response or reader notification arrives, and the bookmark is subsequently deleted
- **THEN** the temporary save overlay is retired and the RSS list reflects the synchronized deletion instead of keeping a stale saved state

#### Scenario: A later rename skips the intermediate synchronized value
- **WHEN** a confirmed rename is followed by a different synchronized remark from another device before the client observes the intermediate remark
- **THEN** the later synchronized remark is displayed and a temporary rename overlay cannot hide it

#### Scenario: Add a subscription on a local client
- **WHEN** an owned local RSS client receives a confirmed subscription addition before its latest entries synchronize
- **THEN** the client immediately shows the confirmed subscription and receives its latest entries through local synchronization, without requesting a REST entry list to seed the source; explicit history loading continues to use the history API

#### Scenario: Repeated RSS activation and automatic checks
- **WHEN** the sidebar and RSS panel initialize for the same account, the user switches sources, or automatic list checks run
- **THEN** concurrent Labs consumers share one request and a successful response is reused for that browser account instead of polling Labs; explicit settings refresh and account changes may obtain a new response, and a late response from a replaced account cannot alter the active account
