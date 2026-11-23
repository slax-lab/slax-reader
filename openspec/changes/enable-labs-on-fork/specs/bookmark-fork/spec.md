## MODIFIED Requirements

### Requirement: Authorized online Fork

The system SHALL let an authenticated active user copy a currently readable Reader snapshot through an online Fork command. It SHALL authorize the source before copying and revalidate access and source identity at publication. Interactive commands SHALL reuse `POST /v1/bookmark/add_url` and return its existing HTTP/envelope success and empty `bmId` acknowledgement after persisted admission, without waiting for R2 transfer or content success. Background copying SHALL use existing bounded Workflow execution and guarded status transitions. Fork copies already acquired content without crawling the Reader page, fetching the original site, or generating provider content.

#### Scenario: Copy a shared article

- **WHEN** a signed-in user Forks another user's accessible completed article
- **THEN** the user promptly receives the existing add_url acknowledgement, and background copying makes its required artifacts readable before marking success without fetching the original website

#### Scenario: Inaccessible source

- **WHEN** a visitor attempts to Fork an unshared, trashed, moderated or deleted-owner snapshot
- **THEN** the request reports unavailable without disclosing source identity or creating destination content

#### Scenario: Gate applies to resolved format

- **WHEN** a Reader link resolves to an otherwise eligible snapshot whose matching Lab is off for the destination user
- **THEN** the request proceeds through normal Fork admission and can be acknowledged while the Lab is still off

#### Scenario: Source changes before publication

- **WHEN** source content, resource identity or permission changes before the final publication check
- **THEN** the command retries within a bound or reports not-ready/unavailable without publishing an unauthorized or mixed copy

## ADDED Requirements

### Requirement: Eligible Fork publication enables the matching Lab

A disabled Lab SHALL NOT prevent an otherwise eligible Fork of a snapshot that matches its activation rule. Successful publication SHALL enable only the matching active Lab for the destination account in the same database transaction as the completed copy. This applies to online and synchronous Forks. A snapshot without a matching rule SHALL leave all Labs settings as they were.

#### Scenario: Fork from a fresh account with Labs off

- **WHEN** a signed-in account with Labs off explicitly Forks an accessible completed PDF, podcast, or YouTube video snapshot
- **THEN** the copy becomes readable and enables only `pdf`, `podcast`, or `youtube` respectively
- **AND** a YouTube video Fork leaves `youtube_article` as it was, including when the source contains a ready AI article

#### Scenario: Fork an ordinary HTML article

- **WHEN** an ordinary HTML article is successfully Forked, including a podcast URL originally saved as a normal page or an HTML article whose URL ends in `.pdf`
- **THEN** every Labs setting retains its previous value

#### Scenario: Fork a historical YouTube snapshot

- **WHEN** the user Forks an accessible historical video snapshot recognized by the existing YouTube video URL rule and it has no stored media reference
- **THEN** successful publication enables only `youtube`

#### Scenario: Online acceptance precedes publication

- **WHEN** the API acknowledges a Fork of a snapshot whose corresponding Lab is off and its copy is still processing
- **THEN** the Lab stays off while the copy is pending and becomes enabled in the commit that makes the copy successful

#### Scenario: Fork stops before successful publication

- **WHEN** source access fails, the required snapshot copy fails, or the publication transaction rolls back
- **THEN** the attempted Fork leaves all Labs settings as they were

#### Scenario: Synchronous Fork succeeds

- **WHEN** a supported import or Telegram save successfully publishes an eligible Reader snapshot Fork for an account with the corresponding Lab off
- **THEN** the destination copy and the matching Lab become available together

#### Scenario: Enabled Lab and a later explicit refresh

- **WHEN** publication succeeds for a user who already has the matching Lab on
- **THEN** that Lab stays on and retains its original enablement timestamp
- **AND** if the user later turns it off and explicitly publishes another Fork of the same eligible type, the new successful publication enables it again

#### Scenario: Existing item is returned without publication

- **WHEN** a user views a snapshot, gets their own existing item back, or receives a duplicate acknowledgement without a new publication
- **THEN** the operation leaves all Labs settings as they were

#### Scenario: External acquisition

- **WHEN** a user with the corresponding Labs off saves an original provider URL or uploads a PDF through the normal acquisition flow
- **THEN** the acquisition follows its existing Labs rules and leaves the corresponding preferences as they were
