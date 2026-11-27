## ADDED Requirements

### Requirement: Explicit toolbar actions

The Extension SHALL open a native action popup from the toolbar and its action shortcut for a signed-in user. The popup SHALL offer saving the current page and opening Inbox, in that order.

#### Scenario: Open without saving

- **WHEN** a signed-in user invokes the toolbar action or its shortcut
- **THEN** the popup opens without submitting a save

#### Scenario: Invoke the toolbar action while signed out

- **WHEN** a signed-out user invokes the toolbar action or its shortcut
- **THEN** the Extension opens or focuses the existing Slax sign-in destination

#### Scenario: Choose a popup action after the session expires

- **WHEN** the user chooses Save, Inbox, or a notification from a popup with an expired session, or that action reports a current-session authorization failure
- **THEN** the Extension opens or focuses the sign-in destination
- **AND** a passive background authorization failure clears the session without opening a sign-in tab

#### Scenario: Choose an action

- **WHEN** the user chooses Save current page or Open Inbox
- **THEN** Save uses the existing page or PDF collector, and Open Inbox opens the Web Inbox in a new tab

#### Scenario: Save an ordinary webpage from the popup

- **WHEN** the user saves an ordinary unsaved webpage
- **THEN** the button shows three loading dots in the same muted color as the disabled saving label while the request is pending
- **AND** after the server acknowledges the save, the completion icon and disabled saved label use the primary accent color
- **AND** both disabled states sit directly on the paper background, and clickable actions use the filled primary style
- **AND** after the current bookmark becomes readable in local sync, the button becomes an action that opens its reader detail page
- **AND** the saving-to-saved and saved-to-readable transitions fade the primary content out and in unless the user prefers reduced motion

#### Scenario: Reopen the popup before processing completes

- **WHEN** the user reopens the popup on a page whose save was accepted in the same browser session but remains unreadable
- **THEN** the popup shows the disabled saved label until the reader action becomes available

#### Scenario: Save submission fails

- **WHEN** the save request fails without an acknowledgement
- **THEN** the popup shows actionable feedback and enables retry, or uses the sign-in handoff on authorization failure
- **AND** a Labs rejection shows the existing localized reason and a link to the Labs settings

#### Scenario: Processing ends in failure after acknowledgement

- **WHEN** the current unreadable bookmark reaches the failed processing state
- **THEN** the popup enables the save action again so the user can retry through the existing collector

#### Scenario: The saved source URL is normalized

- **WHEN** a save is stored under the API's normalized source URL
- **THEN** the popup recognizes the synchronized bookmark from the original source tab and can open its reader after processing

#### Scenario: Distinguish the main action, notification list, and Inbox

- **WHEN** the popup opens in its native frame
- **THEN** Save is the filled primary action above a notification section whose bell and localized label are grouped above the shared light card
- **AND** the panel and footer use the Web Inbox light background color, with a subtle outline around the notification card
- **AND** a text-aligned divider separates two notification rows, with spacing above and below the divider matching the card padding
- **AND** the Inbox icon, label, and arrow are centered as one group in a control whose hit area and hover fill cover the footer below the card
- **AND** the default rows have source icons for followed collections or completed saves, and visible coral unread dots
- **AND** the Save action and notification card sit 16 CSS pixels from both popup sides, and keyboard focus remains visible within the controls

### Requirement: Local account reminders

The popup SHALL derive at most two current-account notifications from the existing PowerSync data. Subscriptions SHALL use the existing unread meaning and omit counts. When both kinds are eligible, the popup SHALL show the highest-ranked subscription first and the highest-ranked readable save second. When only one kind is eligible, the popup SHALL display up to two from that kind in its existing order.

#### Scenario: Both notification kinds are available

- **WHEN** two subscriptions and two readable saves have eligible notifications
- **THEN** the popup displays only the highest-ranked subscription and highest-ranked save, with the subscription first

#### Scenario: One notification kind is available

- **WHEN** notifications are available only for subscriptions or only for readable saves
- **THEN** the popup displays up to two from that kind in its existing order

#### Scenario: A long subject is displayed

- **WHEN** a collection name or bookmark title does not fit on its notification line
- **THEN** the popup displays one ellipsis in the middle of the subject, preserving its corner quotes, the full localized status, and the coral dot at the end of the clickable row

#### Scenario: Save completes after an Inbox visit

- **WHEN** the main Inbox displays a local snapshot while a bookmark is still processing
- **THEN** its subsequent readable state can produce a reminder after reopening the popup

#### Scenario: Inbox clears readable saves

- **WHEN** the main Inbox displays a usable current-account snapshot
- **THEN** all eligible readable save reminders in that snapshot are cleared in that browser and subscription unread cursors are unaffected

#### Scenario: Open a reminder

- **WHEN** a user selects a reminder
- **THEN** the popup hides it and opens its reader or collection after the corresponding local dismissal or cursor write

#### Scenario: Data temporarily unavailable

- **WHEN** the current account or a usable local snapshot cannot be confirmed
- **THEN** the popup hides the notification section without exposing a previous account's reminders

#### Scenario: No unread reminders

- **WHEN** the notification list has no rows
- **THEN** the heading and notification card are hidden

### Requirement: Toolbar unread dot

The Extension SHALL show one red dot on the toolbar icon when the current account has any unread popup notification. The dot SHALL update while the popup is closed. The dot SHALL preserve the existing per-tab saved-page checkmark.

#### Scenario: Unread reminders arrive or are cleared

- **WHEN** PowerSync exposes the first eligible reminder while the popup is closed
- **THEN** a red dot appears, stays visible when the popup is simply opened, and clears when the last eligible reminder is cleared or the account is signed out
