# Spec Delta

## Purpose

Explain a Mobile client's download and sync failures with one bounded snapshot of its network path, without changing how the client loads content.

## ADDED Requirements

### Requirement: Record one network diagnostic per failure family per app process

The Mobile app SHALL record a `kind=network` client error with `error_name=NetworkDiagnostic` when one of these fails while the device is not known to be offline:

- a Reader article image download, family `image`
- an article content download, family `content`
- a PowerSync connection attempt or stream, family `powersync`

The record SHALL carry `properties.source=network_diagnostic` and `properties.family`. The app SHALL record at most one diagnostic per family per app process. A failure while the device is offline, a cancellation, a 4xx response other than 408 and 429, or an authorization failure SHALL NOT produce a diagnostic and SHALL NOT consume the family's single record. When a probe is already running for a family, later failures of that family SHALL NOT start another probe. Recording the diagnostic SHALL NOT delay, retry, or change the failed operation. A failure anywhere in probing or recording SHALL NOT propagate to the caller. The existing PowerSync and API failure records SHALL be unchanged and SHALL remain the counting source for those failures.

#### Scenario: Many images fail in one session
- **WHEN** a Reader article has twenty images that fail to download while the device is online
- **THEN** exactly one `NetworkDiagnostic` record with `family=image` is delivered for that app process

#### Scenario: Different failure families fail
- **WHEN** an image download fails, then an article content download fails, then a PowerSync stream fails, all while online
- **THEN** one diagnostic each for `image`, `content`, and `powersync` is delivered

#### Scenario: A failure happens offline first
- **WHEN** an image fails while the device is offline and later another image fails while online
- **THEN** no diagnostic is recorded for the offline failure and one `image` diagnostic is recorded for the online failure

#### Scenario: The app process restarts
- **WHEN** the app is terminated and relaunched and an image fails again while online
- **THEN** a new `image` diagnostic is recorded for the new process

#### Scenario: A client error or cancellation occurs
- **WHEN** an image request is cancelled because the Reader closed, or a content request fails with 401 or 404
- **THEN** no diagnostic is recorded and the family can still record one later

### Requirement: Diagnostics describe the path to the failing Slax host

A diagnostic SHALL probe only the Slax-owned host involved in the failure:

- the image proxy origin for images
- the API origin for content
- the PowerSync endpoint host for sync

It SHALL record that host name in `properties.host`. The record SHALL include each of the following when the platform exposes it:

- `properties.dns.system`: the system resolver's answer, with an address count per IPv4 and IPv6 family, the lookup duration, and an error class on failure
- `properties.dns.public`: the IPv4 address count, duration and error class from `1.1.1.1`
- `properties.tcp.v4` and `properties.tcp.v6`: TCP connect outcome and duration to port 443 on the host's first address of each family
- `properties.network`: transport (`wifi`, `cellular`, `ethernet`, `vpn`, or `other`), `vpn`, `metered`, and `ipv6_route` states, plus `private_dns` and `validated` on Android
- `properties.failure`: the failed operation's HTTP status when one exists, its error class, and whether it timed out
- `properties.image_failure` (Android): for the image family, the most recent native image failure that was not a cancellation, as an HTTP status, an error class, and terminal and timeout flags

Each probe step SHALL be bounded, and the probe SHALL run off the shared native module queue. When the probe has not finished within ten seconds, the record SHALL be captured without probe results and with `properties.probe_error=timeout`. A probe that cannot run SHALL be omitted rather than fail the record. A content failure SHALL produce a diagnostic only for a network, timeout or HTTP outcome, not for account, session, protocol or local engine errors. The record MUST NOT contain the device's IP addresses or the resolved addresses themselves. It MUST NOT contain article or third-party host names, URLs with query strings, tokens, cookies, request or response bodies, or article content.

#### Scenario: An image proxy request times out over a stalled IPv6 route
- **WHEN** an image download times out on a network whose IPv6 path to the proxy stalls
- **THEN** the `image` diagnostic names the proxy host, reports both DNS families resolved, reports `tcp.v6` as failed or slow and `tcp.v4` as connected with its duration, and on Android reports `image_failure.timeout=true`

#### Scenario: DNS fails
- **WHEN** the system resolver cannot resolve the API host during a content failure
- **THEN** the `content` diagnostic records the system DNS error class, still records the public resolver result, and omits TCP probes that have no address to use

#### Scenario: The diagnostic is inspected for private data
- **WHEN** any diagnostic record is delivered
- **THEN** it contains address counts and timings but no IP address, no article host, no query string, and no token
