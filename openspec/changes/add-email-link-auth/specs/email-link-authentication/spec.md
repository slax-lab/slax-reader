# Email Link Authentication Delta

## Purpose

Allow readers to sign in through a one-time link delivered to their email, using the existing account identity and session rules across Web and native Apps.

## ADDED Requirements

### Requirement: Login emails offer code and link together

The existing email delivery endpoint SHALL deliver both a six-digit code and an HTTPS sign-in link for login requests. The delivery response SHALL retain its current challenge metadata and SHALL NOT expose the link secret. Mailbox-binding requests SHALL continue to deliver only their existing code. Existing delivery limits SHALL continue to apply to the single combined login email.

#### Scenario: Web or App requests login email

- **WHEN** a valid login-email request is accepted from Web, iOS, or Android
- **THEN** one email contains the code and sign-in link with the same five-minute expiry
- **AND** the response contains challenge metadata without a usable link proof

#### Scenario: An authenticated reader binds a mailbox

- **WHEN** a mailbox-binding email is requested
- **THEN** the existing authenticated code-verification flow remains in use
- **AND** the email does not offer link-based mailbox binding

### Requirement: Code and link share a single-use attempt

The system SHALL accept a valid link proof through the existing login endpoint. Code and link SHALL share challenge expiry, replacement, verification-attempt limits, and consumption. At most one verification of either proof SHALL succeed for the same challenge. Viewing the HTTPS resource without submitting a login proof SHALL NOT consume it.

#### Scenario: The code is used before the link

- **WHEN** a code succeeds and its email link is subsequently submitted
- **THEN** the link is rejected without creating a session

#### Scenario: The link is used before the code

- **WHEN** a link succeeds and the corresponding code is subsequently submitted
- **THEN** the code is rejected without creating a session

#### Scenario: Two clients submit the proofs concurrently

- **WHEN** valid link and code proofs for the same challenge are submitted concurrently
- **THEN** at most one verification succeeds

#### Scenario: A proof is expired or superseded

- **WHEN** a link is submitted after its five-minute expiry, a newer email replaces it, or its shared attempt budget is exhausted
- **THEN** login is rejected and the client offers a fresh email request

#### Scenario: Mail software fetches the landing page

- **WHEN** the email-login HTTPS page is fetched without a login submission
- **THEN** no session or binding is created and the challenge is not consumed

### Requirement: Link authentication preserves email account ownership

Successful link verification SHALL use the same account eligibility, explicit mailbox ownership, registration, and session result as successful email-code verification. It SHALL NOT implicitly attach a historical Google or Apple account solely because its profile email matches.

#### Scenario: The mailbox is already linked

- **WHEN** the reader proves a mailbox linked to an active account
- **THEN** login opens that same account with its existing data

#### Scenario: The mailbox is new

- **WHEN** the reader proves an unclaimed mailbox allowed by the existing email registration policy
- **THEN** the existing email registration flow creates the account and login-mailbox binding

#### Scenario: An unlinked historical account reserves the address

- **WHEN** the address matches an existing account that requires explicit linking under the email-code policy
- **THEN** link login applies the same refusal and existing-method guidance
- **AND** no implicit account merge or duplicate account is created

### Requirement: Native link handling falls back to Web

The HTTPS link SHALL support opening the associated iOS or Android App at the email-login entry when OS routing permits. The App SHALL parse the proof and request login after opening. If no compatible App opens, the same link SHALL offer Web login. Neither client SHALL select its API server from untrusted URL parameters.

#### Scenario: The App is not running

- **WHEN** the OS opens a compatible signed App using the email link
- **THEN** the initial link is handled after local session readiness
- **AND** a valid proof can complete the existing App session flow

#### Scenario: The App is already running

- **WHEN** the App receives the email URL while running
- **THEN** it handles the URL through the same login flow without creating duplicate concurrent attempts

#### Scenario: The App is unavailable or browser routing is chosen

- **WHEN** the email link opens in a browser instead of a compatible App
- **THEN** the Web email-login page can complete login without an App installation or repeated launch attempts

#### Scenario: A link targets another environment

- **WHEN** an unauthenticated App receives a URL outside its configured email-login origin or path
- **THEN** it does not submit that proof to its active API or change its API environment
- **AND** for a recognized public email-login host belonging to another environment, it offers explicit browser continuation without reopening the App

### Requirement: An email link never replaces a current session

Web and native clients SHALL retain any authenticated account when an email link opens, including when it refers to the same mailbox. They SHALL explain that the reader must sign out and reopen the email link. They SHALL NOT submit or consume the proof while that session is active. Abandoned or superseded client attempts SHALL NOT install a late session or navigate as another account.

#### Scenario: A signed-in reader opens a link

- **WHEN** an email link opens in an authenticated Web or App client
- **THEN** the current account and its local data remain active
- **AND** the client displays sign-out guidance without a login submission

#### Scenario: Session or environment changes during login

- **WHEN** a pending client attempt is abandoned by navigation, disposal, or account/API-origin replacement
- **THEN** its eventual result does not write credentials or navigate the replacement context

### Requirement: Link proofs remain private during handoff

Clients SHALL NOT transmit email-link proof values in landing-page HTTP URLs, analytics, diagnostic logs, or post-login navigation. An explicit browser-continuation action SHALL carry proof only in the fragment of the fixed browser-only entry on a recognized public host, without a server redirect or arbitrary destination. Only the login submission SHALL send the proof to the intended API. Malformed incoming URL data SHALL fail before submission.

#### Scenario: The Web landing page starts

- **WHEN** the browser opens an email link
- **THEN** the proof is retained only transiently for authentication and removed from the visible URL before analytics scripts run
- **AND** no proof is included in page telemetry or subsequent navigation

#### Scenario: A link lacks required proof data

- **WHEN** a malformed link is opened
- **THEN** no login request is sent and localized guidance offers the normal email-login flow

### Requirement: Email-link states are usable and recoverable

The new Web and native flow SHALL expose localized pending, failure, and current-session guidance using the existing application design and agreement rules. Failure SHALL offer a fresh email-login flow without automatically replaying the old proof. Successful link login SHALL use the client's normal authenticated destination; existing code-login return behavior SHALL remain intact.

#### Scenario: Login fails or the proof was already used

- **WHEN** link login cannot complete
- **THEN** persistent guidance replaces loading and offers a fresh email request
- **AND** the client does not automatically retry the old proof

#### Scenario: Link login succeeds

- **WHEN** an unauthenticated client completes link login
- **THEN** Web proceeds to bookmarks or the App enters its existing authenticated shell
- **AND** another requesting tab or device is not automatically signed in

#### Scenario: A native link opens on a device without agreement

- **WHEN** an unauthenticated App receives a valid link and its existing agreement requirement has not been satisfied
- **THEN** it shows the existing agreement flow before any login submission
- **AND** declining or leaving discards the pending proof without submitting it
