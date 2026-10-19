# Spec Delta

## Purpose

Define isolated desktop HTML and PDF reading, compatible annotations and host interactions while keeping saved content outside application trust.

## ADDED Requirements

### Requirement: Isolated article document

HTML articles SHALL render in a script-enabled sandbox without same-origin privileges. Only trusted reader code SHALL execute; article-provided scripts, event handlers, active embeds and direct network requests SHALL be blocked. Article documents and images SHALL load through account/document-scoped native resource handles rather than arbitrary external URL proxies.

#### Scenario: Hostile saved HTML

- **WHEN** an article includes scripts, event handlers, remote frames, executable links or crafted image paths
- **THEN** untrusted code does not execute or gain IPC, credentials, external connections or unrelated cached resources

#### Scenario: Retired article resource

- **WHEN** an old document or account resource URL is requested after retirement
- **THEN** the resource is rejected even if its bytes still exist in storage

### Requirement: Validated frame messaging

The host SHALL accept a frame message only from the active frame window with a valid channel, page identity, bounded payload and supported message schema. Frame commands SHALL identify the current document and request. Navigating, replacing a document or account, or disposing the reader SHALL cancel pending commands and ignore stale replies.

#### Scenario: Wrong source or page

- **WHEN** another window posts a matching-looking reader envelope or the previous page replies
- **THEN** the host rejects it and no core action runs

#### Scenario: Document replaced during command

- **WHEN** the user navigates before an annotation or selection query returns
- **THEN** the old result cannot change the new document

### Requirement: Selection annotations and comments

The reader SHALL support mouse and keyboard text selection, highlights, comments/replies, tag editing and native selection/link context actions using the existing cross-platform source and permission contracts. The host SHALL position tools from current frame and selection geometry after scrolling/resizing. The core SHALL independently recheck mutation rights.

#### Scenario: Selection across paragraphs

- **WHEN** the user selects Unicode text across article paragraphs and adds a highlight or comment
- **THEN** the persisted source round-trips with the other clients and tools target the correct visible selection

#### Scenario: Frame moved

- **WHEN** the window resizes or the article scrolls while a selection tool is open
- **THEN** the tool tracks valid geometry or dismisses safely rather than targeting different content

### Requirement: Progress AI and sharing

The reader SHALL restore and persist reading position, render cancellable streamed AI overview and outline results, navigate outline anchors, show an image gallery and create/revoke share links through existing core/API policies. Stream results SHALL be scoped to the current account and document and surface actionable failure and retry states.

#### Scenario: AI stream after navigation

- **WHEN** an AI stream produces output after the reader changes documents
- **THEN** no old output is applied to the active document and the old stream is cancelled

#### Scenario: Reading resume

- **WHEN** the user reopens an admitted cached article
- **THEN** the stored reading position is restored against the current document layout

### Requirement: Binary PDF transport and compatible marks

PDF reading SHALL use bundled rendering resources with document scripts and unsafe external actions disabled. Requested file ranges SHALL cross IPC as binary ArrayBuffer data, with core validation of bounds, length and document identity. Selection and marks SHALL use the existing PDF source schema and restore across clients. PDFs SHALL not be silently passed to the HTML renderer.

#### Scenario: Range delivery

- **WHEN** the PDF renderer requests an allowed range
- **THEN** it receives the exact binary bytes without base64 conversion and invalid bounds are rejected

#### Scenario: Scripted PDF

- **WHEN** a PDF contains a document script or executable action
- **THEN** it does not execute with application or network privileges

#### Scenario: Mark interoperability

- **WHEN** a valid PDF mark created in another client is synchronized
- **THEN** the corresponding page/text region can be rendered and edited subject to existing rights

### Requirement: External links and proposed video playback boundary

External HTTP(S) links SHALL require user confirmation before the system browser opens them. Executable, file and arbitrary application schemes SHALL be rejected. Under the strict no-network article policy, saved YouTube transcript reading SHALL remain available and playback SHALL be offered through the confirmed system-browser action; in-app playback SHALL not be claimed as supported. This proposed resolution requires review with the rest of this change.

#### Scenario: External link cancelled

- **WHEN** the user cancels an article link or YouTube playback action
- **THEN** no external application opens

#### Scenario: Video playback requested

- **WHEN** the user confirms the playback action for a validated YouTube URL
- **THEN** the system browser opens it without relaxing article or shell content policies

### Requirement: Continuous document presentation

Article headings SHALL scroll with the article. Saved first-party image proxy references SHALL resolve to validated public source images through native capabilities. Non-success bookmark processing states SHALL remain visible in the reader column. Comment subscriptions SHALL use bookmark_uuid and remain owned by the corresponding live document.

#### Scenario: Highlight uploaded

- **WHEN** a locally created highlight or comment uploads and its remote version returns
- **THEN** the matching subscribed row remains visible instead of disappearing after queue completion

#### Scenario: Article processing

- **WHEN** a selected bookmark is pending, parsing, retrying, updating or failed
- **THEN** its title and localized processing state appear in the third column, and success transitions to readable content
