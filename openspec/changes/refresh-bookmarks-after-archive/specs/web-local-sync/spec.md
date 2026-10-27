## ADDED Requirements

### Requirement: Bookmark lists recover after archive changes

Web SHALL notify open bookmark lists after a successful archive or unarchive action. Notifications SHALL identify the account and bookmark UUID. Failed actions and obsolete account sessions SHALL NOT publish successful changes. REST lists SHALL reconcile with server data. Local lists SHALL refresh their database queries without replacing pending local mutations with server data.

#### Scenario: Archive from another reader tab
- **WHEN** a user archives an article in another tab and returns to the Inbox
- **THEN** the Inbox removes that article without a manual reload
- **AND** the active filter and loaded list range remain intact

#### Scenario: Unarchive from another reader tab
- **WHEN** a user restores an archived article to the Inbox in another tab
- **THEN** open Inbox and Archive lists reconcile with the new state

#### Scenario: Missed notification
- **WHEN** a bookmark list becomes visible or active after a missed notification
- **THEN** it rechecks the current data without clearing the displayed list first
- **AND** duplicate foreground events share a bounded refresh

#### Scenario: Failed refresh
- **WHEN** a foreground refresh fails or returns an invalid response
- **THEN** the list retains its existing items and permits a later recovery attempt

#### Scenario: Obsolete account or filter
- **WHEN** an archive notification belongs to another account or a refresh response belongs to a replaced account or filter
- **THEN** it cannot alter the current list

#### Scenario: Pending local archive
- **WHEN** a local archive has not reached the server and the list returns to the foreground
- **THEN** the refresh preserves the local change and does not write stale server state into the database

#### Scenario: Loaded pages
- **WHEN** a REST list has loaded several pages before an archive or foreground refresh
- **THEN** it refreshes that loaded range atomically and retains correct pagination for subsequent loading
- **AND** it preserves the scroll position where the remaining list height permits
