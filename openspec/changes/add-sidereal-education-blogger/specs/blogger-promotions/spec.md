# Blogger promotions

## Purpose

Let readers identify participating KOC bloggers and use their activity IDs in the existing subscription promotion flow.

## ADDED Requirements

### Requirement: Sidereal Education profile

The blogger information endpoint SHALL recognize the `siderealedu` blogger identifier and return the specified display name, avatar URL, existing blogger activity type, and activity ID.

| Identifier | Display name | Avatar URL |
| --- | --- | --- |
| `siderealedu` | Sidereal Education | `https://reader-img.slax.com/koc/siderealedu.jpg` |

#### Scenario: Look up Sidereal Education

- **WHEN** a reader requests `/v1/promotion/blogger_info?blogger=siderealedu`
- **THEN** the response succeeds with the specified profile, the existing blogger activity type, and `siderealedu` as the activity ID

### Requirement: Sidereal Education activity validation

The subscription promotion claim endpoint SHALL accept `siderealedu` as a recognized blogger activity ID while retaining existing eligibility checks and production Turnstile verification.

#### Scenario: Claim through Sidereal Education

- **WHEN** an eligible reader submits `/v1/promotion/receive` with the existing blogger activity type and `siderealedu` as the activity ID, satisfying existing verification requirements
- **THEN** the request proceeds through the existing subscription claim flow using `siderealedu`
