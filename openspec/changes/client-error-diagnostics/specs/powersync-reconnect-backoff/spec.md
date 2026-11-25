# Spec Delta

## Purpose

Bound PowerSync reconnection work after repeated failures so a client that cannot reach the sync service stops retrying every few seconds, while preserving sync semantics and resuming promptly when connectivity returns.

## ADDED Requirements

### Requirement: Consecutive sync failures back off exponentially

When a Web or Mobile PowerSync connection fails repeatedly, the client SHALL delay the next connection attempt by an interval that starts at 5 seconds and doubles for each consecutive failure, capped at 2 minutes. The client SHALL make at most one connection attempt per interval, SHALL keep a single pending retry, and SHALL reset the interval after a successful connection. The client SHALL NOT change PowerSync synchronization semantics, upload order, queued local changes, or the ext-bridge protocol. Upload failures SHALL keep their existing retry behavior and SHALL NOT be treated as stream connection failures for this backoff.

#### Scenario: The first failure delays five seconds
- **WHEN** the sync stream fails with no preceding failure in the current episode
- **THEN** the next connection attempt is not made before 5 seconds have elapsed

#### Scenario: Failures keep doubling up to the cap
- **WHEN** consecutive connection attempts fail
- **THEN** the delays follow 5, 10, 20, 40, 80 and 120 seconds and remain at 120 seconds for later failures

#### Scenario: A connection succeeds
- **WHEN** a connection succeeds after a failure
- **THEN** the failure count and delay reset, and a later failure starts again at 5 seconds

#### Scenario: An upload is rejected
- **WHEN** an upload is rejected while the sync stream is otherwise healthy
- **THEN** the stream reconnect schedule is unchanged and the existing upload retry behavior applies

#### Scenario: The ext-bridge page reconnects
- **WHEN** the Web `/x/ext-bridge` page experiences the same stream failure
- **THEN** it follows the same backoff without changing the bridge protocol or the messages it exchanges

#### Scenario: Several tabs share one worker
- **WHEN** several Web tabs share one sync worker
- **THEN** the shared connection follows one backoff schedule and the tabs do not multiply the attempts

### Requirement: Offline and foreground transitions control reconnection

The client SHALL pause reconnection while the network is offline, SHALL NOT attempt a connection while offline, and SHALL reconnect immediately when the network returns online or when the app returns to the foreground. An offline pause is not a failure and SHALL NOT produce an error record. A pending retry SHALL be cancelled when the account, runtime, or API origin changes.

#### Scenario: The network goes offline
- **WHEN** the network becomes unavailable during a failure episode
- **THEN** no further connection attempt is made and no error record is created for the pause itself

#### Scenario: The network returns
- **WHEN** the network becomes available again
- **THEN** a connection attempt starts immediately instead of waiting for the remaining backoff delay

#### Scenario: The app returns to the foreground
- **WHEN** the app or page returns to the foreground while connected or retrying
- **THEN** a connection attempt starts immediately if none is pending

#### Scenario: The account changes
- **WHEN** the account or API origin changes while a retry is pending
- **THEN** the pending retry is cancelled and cannot connect the previous account or origin
