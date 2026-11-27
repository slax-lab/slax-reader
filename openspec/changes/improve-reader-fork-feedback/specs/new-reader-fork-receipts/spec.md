## Purpose

Help new readers find a successfully saved personal copy again from their email.

## ADDED Requirements

### Requirement: First-day receipts follow successful personal copies

The system SHALL send one confirmation per distinct source article saved through the public reader action by an account aged less than 24 hours at authenticated admission. Eligibility SHALL use the stored registration time and server time. Delivery SHALL follow successful publication to the acting account and use a deliverable address belonging to that account.

#### Scenario: Three articles saved during the first day

- **WHEN** an eligible account successfully saves three different shared articles
- **THEN** each article gets its own receipt, including when the reader closes the page before publication

#### Scenario: Admission crosses the boundary during copying

- **WHEN** admission occurs just before the account reaches 24 hours and publication occurs afterward
- **THEN** the article is eligible
- **WHEN** admission occurs at or after exactly 24 hours
- **THEN** no receipt is sent

#### Scenario: Retries and updates

- **WHEN** a request is repeated, a workflow replays, or an already-saved article is viewed
- **THEN** the account receives at most one receipt for that source
- **WHEN** a previous attempt failed and a qualifying retry first succeeds, including reuse of an existing personal bookmark
- **THEN** the successful save is eligible

#### Scenario: Other operations

- **WHEN** publication has not succeeded, the article is the viewer's own, the account has no deliverable address, or the save originated from an ordinary add or import
- **THEN** the operation produces no receipt

#### Scenario: Reader closes the account

- **WHEN** a reader's account is marked deleted
- **THEN** the reader's stored Fork receipts are removed as part of account revocation

### Requirement: Localized receipt and truthful delivery feedback

The receipt SHALL confirm Fork success in the recipient's supported language, identify the saved article when a title is available, and provide a plainly labeled link to https://r.slax.com/. The public reader SHALL show the sent message only after the delivery service accepts the request. A mail failure SHALL preserve the successful copy.

#### Scenario: Titled or untitled receipt

- **WHEN** the recipient opens the confirmation
- **THEN** they can identify the completed save and navigate to Slax Reader using the link
- **WHEN** the article has no usable title
- **THEN** the message refers naturally to the article without empty quotation marks

#### Scenario: Delayed or failed delivery

- **WHEN** mail is delayed or fails after successful publication
- **THEN** the UI confirms the saved copy immediately and does not claim that an email was sent
- **WHEN** the provider later accepts the message while the success feedback is open
- **THEN** the confirmation gains the email-sent line without a second save or page reload
