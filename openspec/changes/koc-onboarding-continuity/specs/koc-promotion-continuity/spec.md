# Spec Delta

## Purpose

Ensure eligible new and returning users can complete a KOC promotion claim despite onboarding, page reloads, cached navigation, or temporary failures.

## ADDED Requirements

### Requirement: KOC navigation uses the root Inbox URL

Authenticated blogger entry and its post-login continuation SHALL target the same-origin root Inbox / with the validated activity_id, activity_type=blogger, and claim=true parameters. The existing /bookmarks list route SHALL remain compatible. Both routes SHALL reconcile invitations and coordinate onboarding consistently without requiring a fresh page instance. Campaign cleanup MUST wait for successful account-scoped persistence, preserve the current pathname and unrelated query/hash state, and coordinate with existing search-parameter consumption.

#### Scenario: Authenticated blogger visit
- **WHEN** an authenticated user visits the valid daguang-reader route
- **THEN** the destination is /?activity_id=daguang&activity_type=blogger&claim=true on the current origin
- **AND** campaign cleanup leaves / when no unrelated URL state remains

#### Scenario: Blogger visit requires login
- **WHEN** an unauthenticated user visits a valid blogger route and completes sign-in
- **THEN** its blogger return flow leads to / with the same validated campaign parameters
- **AND** the journey does not introduce an intermediate /bookmarks destination

#### Scenario: Direct root campaign visit requires login
- **WHEN** an unauthenticated user opens / with a valid KOC campaign query and completes sign-in
- **THEN** authentication preserves that invitation and returns to the root Inbox for account-scoped reconciliation

#### Scenario: Legacy list link remains usable
- **WHEN** a user opens a valid /bookmarks campaign URL, including with an already cached list page
- **THEN** it follows the same eligibility, persistence, and claim-before-onboarding rules as the root URL
- **AND** compatibility does not require removing the legacy route or forcing a page remount

### Requirement: Eligibility remains account-based and server-authoritative

The system SHALL determine KOC eligibility from the authenticated account's activity history and current subscription rules, without a registration-age or registration-channel restriction. All bloggers SHALL share one claim entitlement per account. Existing production bot verification and grant idempotency MUST remain enforced.

#### Scenario: Returning account has not claimed a blogger reward
- **WHEN** an account registered earlier through another channel visits a valid KOC link and has no blogger receipt or active Apple subscription exclusion
- **THEN** it can explicitly claim the KOC reward
- **AND** an earlier ordinary platform trial does not hide or consume that KOC eligibility

#### Scenario: Another blogger was already claimed
- **WHEN** an account that received any blogger reward visits the same or a different blogger link
- **THEN** it receives no additional KOC grant

#### Scenario: Existing reward economics are preserved
- **WHEN** an eligible account confirms a blogger claim
- **THEN** it receives the existing 60-day entitlement addition or USD 11.98 credit for an active bound Stripe subscription
- **AND** the existing ordinary campaign consumption and stacking rules remain unchanged

#### Scenario: Concurrent or repeated submission
- **WHEN** the same account submits the same activity from multiple tabs or retries after a lost response
- **THEN** at most one reward is granted and clients reconcile with server state

### Requirement: Eligibility status explains availability compatibly

The promotion status endpoint SHALL preserve its existing status boolean and add eligibility reasons for valid activities. A received activity SHALL be distinguishable from temporary exclusion due to an active Apple subscription. Eligible results SHALL describe the applicable trial or credit reward. The client MUST tolerate older responses and MUST NOT interpret failures or missing status as eligibility or completed receipt.

#### Scenario: Temporary Apple exclusion
- **WHEN** the account has an active Apple subscription and no receipt for the requested activity
- **THEN** the response retains status=true and identifies active_apple_subscription
- **AND** the Web flow does not cache permanent completion

#### Scenario: Actual receipt takes precedence
- **WHEN** an activity receipt exists, including when the account also has an active Apple subscription
- **THEN** the result identifies already_received

#### Scenario: Older backend response
- **WHEN** a response contains only the legacy boolean
- **THEN** status=false allows explicit claim with compatible wording
- **AND** status=true is treated as unavailable with unknown reason, retaining a deferred invitation

#### Scenario: Status cannot be verified
- **WHEN** the status response is malformed, fails, or times out
- **THEN** the flow offers Retry and Later without marking the campaign received or submitting a reward

### Requirement: Pending invitations survive the user journey

The Web application SHALL preserve a validated pending KOC invitation for the authenticated account across onboarding navigation, same-browser reloads, cached-page reuse, and later visits when browser storage is available. A bare root or legacy bookmarks URL MUST NOT replace pending KOC context with the ordinary campaign. A fresh explicit valid KOC visit SHALL select its blogger for an unsubmitted claim and re-arm presentation.

#### Scenario: Extension-install reload
- **WHEN** a user defers a KOC claim, enters onboarding, reloads after visiting the extension store, and finishes or skips onboarding
- **THEN** the same KOC reward remains available for explicit claim
- **AND** it is not downgraded to an ordinary 30-day campaign

#### Scenario: Cached bookmarks held another activity
- **WHEN** an explicit KOC visit returns to an already cached bookmarks page
- **THEN** the current invitation is reconciled before presentation regardless of the page's original activity

#### Scenario: Account isolation and late responses
- **WHEN** the user switches accounts or a request returns after a newer invitation becomes current
- **THEN** no prior account's pending context, receipt cache, or asynchronous callback controls the new account's presentation or navigation
- **AND** an in-flight submission retains its original activity identity

#### Scenario: Storage is unavailable
- **WHEN** browser storage rejects writes or contains malformed data
- **THEN** the flow remains usable and preserves validated campaign parameters through its active URL and onboarding return route
- **AND** it does not claim durable recovery from a later bare URL without storage

#### Scenario: Invalidity differs from temporary validation failure
- **WHEN** a stored or explicit blogger cannot be validated
- **THEN** an authoritative invalid-blogger result discards that invitation with an explanation
- **AND** transport failure preserves retryable context

### Requirement: KOC claim is presented before automatic onboarding

On an explicit or restored non-deferred KOC journey, the system SHALL resolve eligibility and offer an eligible reward before automatic onboarding. Automatic onboarding MUST wait during resolution, the offer, submission, and success acknowledgement. Claiming SHALL require explicit user confirmation. Choosing Later SHALL allow onboarding while preserving the unclaimed invitation.

#### Scenario: Eligible empty-Inbox visitor
- **WHEN** the account is eligible for KOC and also meets the onboarding conditions
- **THEN** the reward dialog is shown before navigating to onboarding
- **AND** after confirmed success and acknowledgement the current onboarding conditions are evaluated again

#### Scenario: User leaves after confirmed success
- **WHEN** a user explicitly navigates away from the supported promotion surfaces after a confirmed grant but before pressing Continue
- **THEN** the successful presentation is dismissed without requesting another grant
- **AND** returning does not leave onboarding blocked behind a disposed dialog

#### Scenario: User chooses Later
- **WHEN** the user closes an idle reward offer or chooses Later
- **THEN** onboarding can proceed and no reward request is submitted
- **AND** ordinary visits and reloads do not repeatedly open the deferred offer
- **AND** bookmarks and onboarding provide a visible way to resume it

#### Scenario: Pending KOC has precedence
- **WHEN** a KOC invitation remains pending, including after deferral or a temporary failure
- **THEN** the ordinary campaign entry does not replace or compete with it

#### Scenario: Unavailable reward
- **WHEN** the server reports already received or an active Apple exclusion
- **THEN** automatic onboarding can continue without a claim prompt loop
- **AND** the temporary exclusion retains deferred context for later revalidation

#### Scenario: Responsive and keyboard access
- **WHEN** the user operates the offer or its resume entry on desktop, at 769-920px, or on a narrow screen
- **THEN** the controls remain visible, keyboard-operable, and meaningfully labelled
- **AND** dialog focus and dismissal behavior are maintained

### Requirement: Claim outcomes do not force document reloads

Claim handling SHALL update subscription and promotion state explicitly without forcing a document reload. Confirmed success SHALL clear only the matching account's pending invitation. A failed or ambiguous request MUST preserve retryability. Dismissal MUST be disabled during submission, and late callbacks MUST NOT act on an unrelated route, account, or invitation.

#### Scenario: Success with delayed subscription refresh
- **WHEN** the server confirms a grant but refreshing the user profile fails
- **THEN** the grant remains successful, the matching pending invitation is cleared, and the profile refresh can be retried without another automatic claim

#### Scenario: Lost claim response
- **WHEN** a claim may have succeeded but its response is lost
- **THEN** the application retains the invitation and reconciles or retries through the existing idempotent server path

#### Scenario: Another tab completes the claim
- **WHEN** another tab completes a claim or a retry receives an already-received result
- **THEN** the current tab refreshes authoritative status without reloading or granting again

#### Scenario: Authentication changes during submission
- **WHEN** the account logs out or changes before a claim response arrives
- **THEN** the response cannot mutate the newly active account's state or trigger onboarding navigation

#### Scenario: Ordinary campaign uses the shared modal
- **WHEN** an ordinary campaign is claimed or reported unavailable through the shared modal
- **THEN** its caller disposes presentation correctly, refreshes authoritative subscription/status, and informs other tabs without forcing a document reload
