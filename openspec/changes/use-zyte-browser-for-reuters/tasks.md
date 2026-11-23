# Tasks

## 1. Capture behavior

- [x] 1.1 Select Zyte browser HTML with JavaScript for Reuters regular URL saves. Preserve the full article URL and the fallback request mode.
- [x] 1.2 Apply the Reuters access-notice check before storing a successful capture. Keep articles with substantive reporting eligible.

## 2. Verification

- [x] 2.1 Exercise the reported URL through regular fetch and save. Assert the actual Zyte endpoint and request body, rendered article text on success, and zero successful snapshot writes for a notice-only response.
- [x] 2.2 Cover the apex and www hosts, a lookalike host, the existing fallback request mode, and a previously configured browser-rendered host.
- [x] 2.3 Run relevant API tests, the API layer architecture check and strict OpenSpec validation. Record running-environment evidence and the live Zyte result or specific verification gap.
