## ADDED Requirements

### Requirement: Render DXY article pages using the regular fetch providers

The API SHALL keep DXY WeChat article URLs on the regular route and request browser-rendered HTML from both its primary and fallback providers without modifying the submitted query parameters.

#### Scenario: DXY article fetch

- **WHEN** Add URL fetches a `wechat.dxy.cn/news/view` URL
- **THEN** the primary provider receives that full URL with browser rendering enabled

#### Scenario: Primary provider fails

- **WHEN** the primary provider fails while fetching a DXY article
- **THEN** the fallback provider receives the same URL with browser rendering enabled

### Requirement: Preserve the configured browser-host policy

The API SHALL enable browser HTML for each previously configured host and its dot-delimited subdomains, and SHALL NOT enable it for unrelated suffix lookalikes.

#### Scenario: Existing supported subdomain

- **WHEN** a regular fetch uses `www.zhihu.com`
- **THEN** browser HTML remains enabled

#### Scenario: Unrelated hostname

- **WHEN** a regular fetch uses `notwechat.dxy.cn`, `wechat.dxy.cn.example`, or an ordinary unconfigured host
- **THEN** the host policy does not enable browser HTML

### Requirement: Reject known untitled loading placeholders before success writes

For regular pages, the API MUST reject a blank-title parsed result whose normalized text is at most 32 characters and consists entirely of the legacy fix's recognized loading or dialog UI. It MUST NOT write parsed body objects or update bookmark metadata to success for that result.

#### Scenario: DXY shell contains only loading and dialog UI

- **WHEN** the regular parser selects an empty-title result containing only loading or known confirmation UI
- **THEN** parsing rejects before successful R2 or database writes

#### Scenario: Untitled article contains actual prose

- **WHEN** an untitled regular article contains prose beyond the recognized placeholder vocabulary
- **THEN** the new guard does not reject it

#### Scenario: Titled short article

- **WHEN** a regular article has a nonblank title and short content
- **THEN** the new guard does not reject it
