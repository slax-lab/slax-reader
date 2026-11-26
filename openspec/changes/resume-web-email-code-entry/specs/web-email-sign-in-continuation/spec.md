## ADDED Requirements

### Requirement: Resume an unexpired email sign-in challenge

The Web experience SHALL restore a live challenge on the original sign-in surface in the same tab. Let readers change the email or start again after expiry.

#### Scenario: Refresh while collecting mail

- **WHEN** the reader refreshes the login page or reopens the same login modal before the challenge expires
- **THEN** the original address and code step return with the remaining countdown and without resending mail

#### Scenario: Expiry or change of address

- **WHEN** the challenge has expired or the reader explicitly changes the address
- **THEN** the stale challenge cannot be submitted and the reader can request a fresh code

#### Scenario: Successful departure

- **WHEN** verification succeeds and the original surface reloads
- **THEN** the challenge is cleared and the successful verification cannot be replayed
