## MODIFIED Requirements

### Requirement: Mobile-friendly Fork action

Visitor Reader pages SHALL provide a reachable Fork action on desktop and mobile Web. An explicit anonymous save SHALL continue after the authentication it initiated, without another activation. A completed continuation SHALL admit at most one personal copy for that source and account. The action SHALL prevent duplicate submission, show request loading and actionable failure states, and remain on the source after acceptance. On each visit the action SHALL use viewer-scoped persisted Fork status to disable an active or successful copy and permit explicit retry of a failed copy. It SHALL follow existing themes, focus, touch and reduced-motion requirements.

#### Scenario: Phone without an Extension
- **WHEN** a signed-in reader opens a supported shared snapshot at a 320px mobile width and activates Fork
- **THEN** the action remains reachable, acknowledges the save without waiting for copying and stays on the source page with the Fork button disabled

#### Scenario: Offline Fork attempt
- **WHEN** a user activates Fork or submits a Reader URL without a connection
- **THEN** the UI requests a connection, retains useful input and creates no offline Fork job or optimistic placeholder

#### Scenario: Anonymous reader returns from login

- **WHEN** a visitor clicks Save once on a public snapshot and completes that sign-in
- **THEN** the same source is restored, saving continues automatically and exactly one readable copy appears in the new reader's Inbox even if the source tab is closed after sign-in

#### Scenario: Login cancelled or unrelated

- **WHEN** a visitor cancels sign-in, opens a plain return URL or later signs in independently
- **THEN** no article is saved on that account

#### Scenario: Admission fails or repeats

- **WHEN** the source becomes inaccessible, the request fails, or the successful callback is replayed
- **THEN** failure offers a retry subject to current access and a repeated success produces only one copy
