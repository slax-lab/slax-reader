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
