# Spec Delta

## ADDED Requirements

### Requirement: A watchdog fails closed when no review ever started

The system SHALL run a periodic scan of open pull requests, on a schedule independent of pull request events and of the review workflows' completion, to detect pull requests whose merge gate will never be reported. A pull request is **eligible** for the scan when it is open, is not a draft, and its head branch lives in this repository (not a fork) — the same conditions under which the review system would activate a run. The scan MUST do nothing at all while reviews are paused.

For an eligible pull request, the watchdog SHALL post a **failure** result on the merge gate's stable status context, on the pull request's current head commit, when all of the following hold: no status with the gate's context exists on that head commit, no review run — automatic or on-demand — exists for that pull request since its head moved, and the pull request has had no activity for longer than a grace threshold that comfortably exceeds normal review latency. The failure description MUST name a concrete remedial action (requesting an on-demand review, or closing and reopening the pull request), and MUST NOT claim a cause the watchdog has not verified. The watchdog MUST NOT itself trigger a review: for the shapes it detects there may be nothing runnable (a conflicted pull request has no merge ref), so it alarms rather than self-heals.

The watchdog MUST NOT post any result for a pull request whose gate context already carries a status, whose review run exists, or that fails the eligibility conditions; in particular, posting nothing when a status already exists makes the watchdog idempotent per head commit, and a genuine gate report posted later on the same commit supersedes the watchdog's failure.

#### Scenario: A deadlocked pull request fails closed

- **WHEN** an eligible pull request's head commit has no gate status and no review run (for example the pull request was opened with conflicts, so no `pull_request` workflow ever ran) and the grace threshold has passed
- **THEN** the watchdog posts a failing status on the gate's context for that head commit, with a description telling the author how to break the deadlock

#### Scenario: A reported pull request is left alone

- **WHEN** the pull request's head commit already carries a gate status — success, failure, or pending
- **THEN** the watchdog posts nothing for that pull request

#### Scenario: A queued or running review is left alone

- **WHEN** a review run exists for the pull request since its head moved but has not yet completed
- **THEN** the watchdog posts nothing for that pull request

#### Scenario: A fresh pull request is left alone

- **WHEN** an eligible pull request has had activity within the grace threshold and has no gate status yet
- **THEN** the watchdog posts nothing, giving a just-triggered review time to run

#### Scenario: Drafts, forks, and paused reviews are left alone

- **WHEN** a pull request is a draft, comes from a fork, or reviews are paused
- **THEN** the watchdog posts nothing for it (and while paused, posts nothing at all)

#### Scenario: The watchdog speaks at most once per head

- **WHEN** the watchdog has posted a failure for a head commit and no new status or run has appeared since
- **THEN** the next scan posts nothing for that commit, because the context now carries a status

#### Scenario: A late genuine review supersedes the watchdog

- **WHEN** the watchdog posted a failure for a head commit and a review later runs and the gate reports its result for that commit
- **THEN** the gate's result is the one the required check shows, replacing the watchdog's failure
