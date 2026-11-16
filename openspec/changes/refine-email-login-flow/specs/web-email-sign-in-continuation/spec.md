# Web Email Sign-in Continuation

## Purpose

Make returning Web email sign-in convenient while keeping successful verification non-repeatable during session completion and departure from the login surface.

## ADDED Requirements

### Requirement: Email login recalls the last successfully authenticated address

The Web client SHALL remember one last successfully authenticated email address in persistent local browser storage for the current origin. Opening email login on either host SHALL prefill that address in the editable email field without automatically expanding the form, sending a code, or selecting email instead of an available provider. Only a successful email authentication SHALL replace the remembered address. Binding a mailbox SHALL neither use nor replace this anonymous login preference.

#### Scenario: A returning reader opens email login

- **WHEN** a reader previously completed email authentication on this browser origin and opens email login on a later visit
- **THEN** the address field contains that last successful address and remains editable
- **AND** no email is sent until the reader submits the form

#### Scenario: A different address fails verification

- **WHEN** the reader enters another address but verification fails or the attempt is cancelled
- **THEN** the remembered successful address remains unchanged

#### Scenario: Another address signs in successfully

- **WHEN** email authentication succeeds for another address
- **THEN** that address replaces the previous remembered address before departure
- **AND** logout does not remove this local convenience preference

#### Scenario: Browser storage cannot supply a usable preference

- **WHEN** browser storage is unavailable or the stored address is invalid
- **THEN** the form opens with an empty address and normal login remains available
- **AND** a storage-write failure does not turn successful authentication into a login failure

#### Scenario: A reader binds an address in account settings

- **WHEN** a reader opens or completes mailbox binding in `/user`
- **THEN** the anonymous remembered address is neither prefilled nor replaced by that operation

### Requirement: The remembered preference contains only the login address

The preference SHALL contain only the address from successful email authentication. The client SHALL NOT persist a verification code, challenge, session token, or account identity as part of this preference, synchronize it to another browser origin, or send it to analytics.

#### Scenario: A successful login is remembered

- **WHEN** the client updates the convenience preference
- **THEN** it stores only the authenticated address using the current browser origin
- **AND** no verification secret or session material is included

### Requirement: Successful verification remains non-actionable during departure

Email login SHALL stay busy and reject repeat verification from the first verification submission through successful session completion and the subsequent whole-page navigation until the old login surface leaves. Resolving a navigation-start operation SHALL NOT re-enable verification on the still-visible page. Code entry, resend, and change-address controls SHALL NOT start another email operation during this interval. Genuine verification failures SHALL restore the existing error and retry behavior. Account binding SHALL retain its existing success, announcement, and focus semantics.

#### Scenario: Navigation has started but the old page remains visible

- **WHEN** verification has succeeded and navigation has been initiated while the old login surface is still visible
- **THEN** Verify remains visibly busy/disabled and pointer, keyboard, or direct form submission cannot initiate another verification
- **AND** code editing, resend, and change-address cannot reopen the email flow during that interval
- **AND** local cancellation cannot reset the successful instance into another actionable form

#### Scenario: Verification returns a wrong-code error

- **WHEN** the server rejects the code before authentication succeeds
- **THEN** the form shows the existing error and permits a corrected retry according to expiry and challenge rules

#### Scenario: A pending login is abandoned before success

- **WHEN** the reader cancels the form or switches to an available provider before email authentication succeeds
- **THEN** the existing abort and stale-result protections remain effective
- **AND** that abandoned attempt does not update the remembered address
