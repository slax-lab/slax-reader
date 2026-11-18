## MODIFIED Requirements

### Requirement: Permanent account-derived receiving address
The system SHALL provision a Newsletter address only for an authenticated active user with Newsletter enabled, configured receiving domain and explicit confirmation of the complete candidate address. The receiving local part SHALL be feed+ followed by the first validated account token of exactly 6–15 lowercase ASCII letters/digits. A newsletter platform binding SHALL retain only the fixed receiving name in both platform_id and user_name. Web SHALL display/copy the complete address composed of feed+, that stored name and the current configured domain. Name reservation and recipient lookup SHALL be independent of the domain, while the receiving service SHALL validate the envelope domain before binding lookup. GET and Labs enablement alone SHALL have no provisioning side effect. Confirmed creation SHALL use the existing setting-enable endpoint and match the confirmed address against the current candidate under the owner row lock, rejecting a stale account/domain rather than issuing an unconfirmed address. An issued receiving name SHALL remain stable after account changes and SHALL never be reassigned after user deletion. Changing the configured domain SHALL change the rendered address without changing the stored binding; setup copy SHALL distinguish the fixed receiving name from the configured domain. The system SHALL use the existing sr_user.deleted_at for account revocation, without adding a binding retirement field or custom binding trigger. Cleanup SHALL retain the ordinary Newsletter binding row as the address reservation.

#### Scenario: Provision and rename
- **WHEN** a user provisions an address and later changes account or display name
- **THEN** GET and repeated user-setting enable return the address built from the original bound name and current configured domain

#### Scenario: Missing, invalid or reserved account
- **WHEN** no address exists and the current account is missing, invalid or already reserved
- **THEN** provisioning returns an actionable error and Web allows setting a valid available account without inventing an address suffix

#### Scenario: Concurrent provisioning and deletion
- **WHEN** competing requests attempt the same prefix or a deleted user previously held it
- **THEN** at most one owner receives it and the reservation remains unavailable to others

#### Scenario: Fixed prefix and length boundary
- **WHEN** a user provisions with a 6–15-character lowercase alphanumeric account or an invalid first-configuration token
- **THEN** the former can create a confirmed address and the latter receives invalid_account without creating a binding; ordinary Reader account settings retain their existing format and requested spelling, and issued addresses retain their existing policy

#### Scenario: Existing stable receiving binding
- **WHEN** a receiving name is already bound and the user later renames
- **THEN** GET and repeated user-setting enable render feed+ followed by the original stored token, without replacing the issued binding

#### Scenario: Account deletion uses existing user state
- **WHEN** an owner is deleted through the existing user-deletion flow, including while an email is being processed
- **THEN** sr_user.deleted_at prevents address access, new admission and late publication, pending mail is cancelled, and the retained binding reserves the issued name without a separate retirement column or trigger

#### Scenario: Existing business mail service
- **WHEN** the account is daguang in the selected Newsletter subdomain
- **THEN** it can receive a prefixed Newsletter address without claiming daguang@slax.app, and root/foreign-domain mail cannot enter its Newsletter

#### Scenario: Receiving domain changes
- **WHEN** the service receiving domain changes after a name was bound
- **THEN** address reads and idempotent confirmation use the same name with the current domain, without updating the binding; confirmation of the old full address is rejected
- **AND** the receiver accepts only the current domain and looks up the extracted bound name, independent of the current Reader account

### Requirement: Independent first-release persistence
The system SHALL use existing newsletter platform bindings, without new binding columns or triggers, and one sr_newsletter_feed row per message, combining admission, pending/ready/cancelled deduplication and final content metadata. It SHALL NOT create sr_feed, sr_newsletter_receipt, Newsletter subscriptions or earlier schema compatibility. The unmerged initial migration SHALL be generated from Prisma through the existing script without RSS ALTER, mirror, backfill, trial cleanup migrations, new binding address uniqueness or handwritten CHECK constraints. Every message field SHALL have a Prisma documentation comment. Application Newsletter receiving-name reservation SHALL serialize its lookup/insert using an advisory transaction lock keyed by `newsletter:` followed by the stored receiving name, independently of the configured domain. The existing owner-row lock SHALL remain in place. Newsletter SHALL NOT write any sr_rss table. Existing RSS model, HTTP contracts, fetching/history/retention/save and synchronization SHALL remain unchanged.

#### Scenario: Independent receive and existing RSS writers
- **WHEN** Newsletter is received while existing RSS clients read, write or refresh
- **THEN** Newsletter uses only its own mail table/content and every RSS table/schema/behavior remains the same as before the feature migration


#### Scenario: Concurrent name reservation across domains
- **WHEN** different users concurrently provision the same receiving name using different configured receiving domains in the same database
- **THEN** the shared name-based advisory transaction lock serializes their reservation checks and inserts, exactly one owner obtains the name, and the other receives an address_reserved conflict

### Requirement: Confirmed collapsible Newsletter setup
The setup card SHALL remember its disclosure preference locally per signed-in user, tolerate unavailable local storage and avoid carrying another user's address, draft, error or confirmation across sessions. Collapsed ready state SHALL retain the title, full address, fixed-name status and copy action. Unconfigured state SHALL retain an actionable setup summary. Expanded state SHALL emphasize the full current address and permanence of the receiving name, with privacy/attachment/management details in lower-emphasis supporting text, using existing Web semantic tokens in light/dark/e-ink at desktop, 768px and narrow widths. The disclosure control SHALL have symmetric 10px horizontal padding and visible keyboard focus.

#### Scenario: Confirm before first creation
- **WHEN** a user submits a valid candidate or presses Enter in the account field
- **THEN** a labelled modal shows the full candidate and explains that its receiving name (the part after feed+) cannot change, including after account rename, while the email domain is managed by service configuration; cancelling performs no writes, while confirmation submits the frozen candidate with pending/duplicate-submit protection

#### Scenario: Occupied account or reserved address
- **WHEN** account setting reports an occupied name or address creation reports a reservation conflict
- **THEN** Web retains the draft, expands the form, identifies the affected field with an announced actionable message and permits another name; infrastructure failure instead offers retry without exposing raw error text

#### Scenario: Disclosure preference and identity changes
- **WHEN** a user collapses the card, reloads, changes signed-in user or loses local-storage access
- **THEN** their available local preference is restored independently; no other user's sensitive state or in-flight confirmation is reused, and storage failure does not block setup/copy

#### Scenario: Disable then re-enable
- **WHEN** a message was pending before Newsletter was disabled and later re-enabled
- **THEN** its durable cancelled state prevents late publication

#### Scenario: Non-dev admission deferred during the dev pilot
- **WHEN** the reviewed beta/prod/legacy-main configuration omits NEWSLETTER_DOMAIN during dev validation
- **THEN** no new Newsletter address can be provisioned and email is not admitted in that installation; enabling Labs alone does not supply a receiving domain
