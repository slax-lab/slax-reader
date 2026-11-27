## MODIFIED Requirements

### Requirement: Existing save actions support PDF viewer tabs without regressing HTML

The extension SHALL support saving from Chrome built-in PDF viewer tabs by selecting Save current page in the action popup opened from the toolbar or Alt+Y, and through its existing page context-menu action where the browser exposes that menu. HTTP(S) tabs with a working HTML collector SHALL retain normal collection. After a bounded collector-readiness wait, online PDF saving SHALL reuse the existing in-page collection feedback when source injection succeeds. If injection is unavailable, the native action surface SHALL show the existing recovery feedback. Normal PDF save feedback MUST NOT open a new tab or separate browser window. URL suffixes and path hints MUST NOT authoritatively classify a document as PDF, bypass a working HTML collector, or trigger PDF Labs rejection.

#### Scenario: Online PDF viewer has no content script
- **WHEN** a user invokes an existing save action on an online PDF viewer whose collector is initially unavailable and can be injected
- **THEN** an in-page collection overlay automatically handles the original source instead of silently returning or trying to serialize the viewer HTML

#### Scenario: Extensionless viewer URL
- **WHEN** a user selects Save current page after opening the action popup on an HTTP(S) PDF viewer URL without a `.pdf` suffix whose collector is ready or can be injected
- **THEN** the existing online PDF flow submits the original URL, including any query string

#### Scenario: Online source injection is unavailable
- **WHEN** an online PDF source cannot host the collector after the bounded wait
- **THEN** the native action surface offers recovery and does not claim that a save was submitted

#### Scenario: HTML at a PDF-looking URL
- **WHEN** a normal HTML page at a `.pdf`-looking URL has a working collector
- **THEN** its existing HTML collection flow remains in use without a PDF-specific gate based on the URL

#### Scenario: Collector becomes ready within the bounded wait
- **WHEN** the HTML collector acknowledges readiness while a save action is waiting
- **THEN** the existing collection UI opens and no fallback submission is created

#### Scenario: Unsupported scheme
- **WHEN** a save action targets a browser-internal, other-extension, data, or blob URL
- **THEN** the extension shows an unsupported-source explanation and does not submit that URL or use it as a privileged fetch target

### Requirement: An already-open local PDF can be acquired with browser-authorized file access

The extension SHALL save the PDF already open at the initiating `file:` source by reading that file in a supported extension context when browser-managed file access and effective file-scheme permission allow it. It MUST NOT require reselection as the only way to save an already-open local PDF. Without file permission, where Chrome prevents source-page injection, selecting Save current page in the toolbar action popup SHALL show “Allow access to file URLs” guidance with a code-drawn illustration of the switch, localized steps, browser extension-settings access, and retry. It MUST NOT claim that requesting an optional permission enables the browser-managed toggle or bypass browser security.

#### Scenario: Local file access is off
- **WHEN** a user invokes save on an already-open local PDF while file access is disabled
- **THEN** the extension does not read the source, shows permission guidance with a switch illustration in the toolbar action bubble before any file acquisition and offers settings and retry, explaining that the already-open file cannot be read without this setting

#### Scenario: Permission is enabled and the extension reloads
- **WHEN** the user enables file URL access and the browser closes the collection overlay or clears its session context
- **THEN** the previously displayed guidance tells the user to return to the original PDF, open the popup from the toolbar or Alt+Y, and select Save current page, which rechecks access and reads the source directly without a file picker or persistent source path

#### Scenario: Operation context survives settings
- **WHEN** the user returns from settings without losing the save operation
- **THEN** explicit retry revalidates the original source and permissions before reading it

#### Scenario: Local filename includes spaces or non-ASCII characters
- **WHEN** an allowed local PDF source has encoded spaces or non-ASCII characters in its name
- **THEN** the extension reads the intended file and derives a safe human-readable basename without transmitting its directory path

#### Scenario: Permission or file disappears
- **WHEN** file access is revoked, the file is removed, or the browser refuses the read
- **THEN** the extension shows a recoverable read/permission error, offers permission guidance or retry, and does not report a successful save
