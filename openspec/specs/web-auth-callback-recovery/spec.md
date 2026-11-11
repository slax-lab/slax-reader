# web-auth-callback-recovery Specification

## Purpose
Keep the Web OAuth callback recoverable when authentication cannot complete, allowing users to restart authorization without replaying a previously submitted code.

## Requirements

### Requirement: Callback failures provide persistent recovery

The Web OAuth callback SHALL replace its loading indicator with localized persistent failure guidance and a usable provider sign-in action when callback processing fails. Invalid callback data SHALL fail before a login request is sent. A transient raw exception toast SHALL NOT be the callback's failure presentation. Recovery SHALL remain accessible at narrow, tablet, and desktop widths and in light, dark, and e-ink themes.

#### Scenario: Login transport fails
- **WHEN** the login request fails with a browser network exception
- **THEN** the spinner stops and persistent recovery guidance is displayed
- **AND** the page does not expose the raw exception as a toast or leave an unhandled rejection

#### Scenario: Provider rejects the callback
- **WHEN** the API rejects the OAuth login, including an invalid or reused authorization code
- **THEN** the callback displays persistent recovery guidance and a fresh sign-in action

#### Scenario: Callback state is malformed
- **WHEN** callback state cannot be parsed or has an invalid required field or provider
- **THEN** no login request is sent and a usable recovery action is displayed

#### Scenario: Post-login navigation fails
- **WHEN** navigation to the requested destination rejects or is explicitly aborted
- **THEN** the page displays a recovery action rather than a blank page or indefinite spinner

### Requirement: An authentication attempt has bounded client waiting

The callback SHALL stop waiting and display localized timeout guidance after 20 seconds without completion, cancel its client request, and prevent that abandoned attempt from writing a login cookie or initiating a later success navigation. Leaving the callback SHALL cancel its pending request and clear its timer. Client cancellation SHALL NOT be described as proof that server authentication failed or stopped.

#### Scenario: Login never responds
- **WHEN** the login request remains pending for 20 seconds
- **THEN** timeout guidance and a fresh sign-in action replace the spinner
- **AND** the client request is canceled

#### Scenario: A response completes after abandonment
- **WHEN** a canceled login attempt subsequently finishes processing
- **THEN** it does not store a login cookie or navigate to a success destination

#### Scenario: User leaves during authentication
- **WHEN** the callback is disposed while login is pending
- **THEN** its pending client request and timeout are canceled

### Requirement: Recovery starts a new provider authorization

A recovery action SHALL initiate a new authorization flow with the original valid provider, return destination, and referral context. It SHALL NOT refresh the old callback or resubmit its code automatically. Malformed state SHALL still offer the normal default sign-in path. Successful authentication, missing-code routing, and the Android deep-link handoff SHALL preserve their existing behavior.

#### Scenario: User retries a failed Google login
- **WHEN** the user activates recovery after a failed Google callback
- **THEN** a new Google authorization is initiated with the original valid return destination and referral code
- **AND** the old code is not submitted again

#### Scenario: Google login originates from a collection
- **WHEN** a Google callback carries valid collection provenance and login must be restarted
- **THEN** the original exchange and fresh authorization preserve that provenance alongside the return/referral context
- **AND** absent or malformed optional provenance does not prevent normal authentication or recovery

#### Scenario: An Apple callback fails
- **WHEN** a valid Apple callback fails and the user activates recovery
- **THEN** a new Apple authorization is initiated with its valid return context

#### Scenario: Login succeeds normally
- **WHEN** the API returns a login token before timeout
- **THEN** the existing login cookie is stored and navigation uses the requested destination or the existing bookmarks default

#### Scenario: Callback is an Android handoff
- **WHEN** the existing Android callback parameters are present
- **THEN** the existing app deep link is used without starting Web login

#### Scenario: Callback has no code
- **WHEN** the callback has no authorization code
- **THEN** it follows the existing login-page navigation
