# Blogger promotions

## Purpose

Let readers identify participating KOC bloggers and use their activity IDs in the existing subscription promotion flow.

## ADDED Requirements

### Requirement: Additional KOC profiles

The blogger information endpoint SHALL recognize these additional blogger identifiers and return the specified display name, avatar URL, existing blogger activity type, and an activity ID equal to the identifier.

| Identifier | Display name | Avatar URL |
| --- | --- | --- |
| `yianggao` | Yiang | `https://reader-img.slax.com/koc/yianggao.jpg` |
| `corina` | Corina | `https://reader-img.slax.com/koc/corina.jpg` |
| `hopeseventeen` | Hope Seventeen | `https://reader-img.slax.com/koc/hopeseventeen.jpg` |
| `senl` | Sen | `https://reader-img.slax.com/koc/senl.jpg` |
| `siderealedu` | Sidereal Education | `https://reader-img.slax.com/koc/siderealedu.jpg` |
| `chloemanilay` | Chloe | `https://reader-img.slax.com/koc/chloemanilay.jpg` |
| `senlinkedin` | Sen | `https://reader-img.slax.com/koc/senl.jpg` |
| `sensubstack` | Sen | `https://reader-img.slax.com/koc/senl.jpg` |

#### Scenario: Look up a newly registered blogger

- **WHEN** a reader requests `/v1/promotion/blogger_info` with any identifier in the table as the `blogger` query parameter
- **THEN** the response succeeds with that blogger's specified profile and activity ID

### Requirement: Additional KOC activity validation

The subscription promotion claim endpoint SHALL accept the eight additional identifiers as recognized blogger activity IDs while retaining existing eligibility checks and production Turnstile verification.

#### Scenario: Claim through a newly registered blogger

- **WHEN** an eligible reader submits `/v1/promotion/receive` with the existing blogger activity type and an activity ID from the table, satisfying existing verification requirements
- **THEN** the request proceeds through the existing subscription claim flow using that activity ID

### Requirement: Existing registry behavior is preserved

Existing blogger profiles and claim behavior SHALL remain unchanged, and unregistered identifiers SHALL continue to fail parameter validation.

#### Scenario: Unknown blogger

- **WHEN** a reader looks up an unregistered blogger or submits an unregistered blogger activity ID
- **THEN** the endpoint returns the existing parameter error

#### Scenario: Existing blogger

- **WHEN** a reader looks up a previously registered blogger
- **THEN** the endpoint returns the same profile and activity ID as before
