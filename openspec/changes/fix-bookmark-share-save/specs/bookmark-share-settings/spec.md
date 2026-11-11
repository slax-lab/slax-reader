# Spec Delta

## Purpose

Allow bookmark owners to save sharing settings reliably when a prior existence read is stale, while preserving existing share identity and access restrictions.

## ADDED Requirements

### Requirement: Immediate successive saves

An authorized owner SHALL be able to save share settings and immediately save the opposite settings after the first request completes, without a duplicate-record failure caused by a stale share-existence read. Each successful response SHALL contain the settings saved by that request, and the system SHALL retain one share record for the owner and bookmark.

#### Scenario: First close followed immediately by reopen
- **WHEN** an owner disables marks for a bookmark without an explicit share record and immediately re-enables them after the first successful response
- **THEN** both saves succeed, one share record remains, and the final stored settings enable marks

#### Scenario: Existing record despite an older absent result
- **WHEN** a share record exists but an earlier existence query reported no record
- **THEN** saving settings updates that record without attempting a conflicting standalone creation

#### Scenario: Overlapping first saves
- **WHEN** two authorized saves initialize settings for the same owner and bookmark
- **THEN** the saves do not fail solely because the other save created the share record, and one record remains

### Requirement: Preserve sharing compatibility

Successful saves SHALL preserve an existing share record's identity, creation time and share code. New records created through bookmark UID requests SHALL retain the empty-code behavior; new records created through legacy bookmark ID requests SHALL retain the generated-code behavior. The endpoint SHALL preserve the current request and response fields and settings mapping, including enabling a disabled share on save.

#### Scenario: Update an existing legacy share
- **WHEN** an owner updates settings for a share with a nonempty share code
- **THEN** its code, identity and creation time remain unchanged and the response reflects the saved settings

#### Scenario: Initialize through either identifier
- **WHEN** an authorized owner first saves settings using a bookmark UID or legacy bookmark ID
- **THEN** the new share respectively has an empty or generated nonempty code, with the requested settings

#### Scenario: Re-enable an existing disabled share
- **WHEN** an owner saves settings for an existing disabled share
- **THEN** that share becomes enabled and retains its existing share code

### Requirement: Retain write admission checks

Share setting saves SHALL continue to require the authenticated owner's bookmark and reject moderated content under the existing rules. A rejected save SHALL NOT create or update sharing settings.

#### Scenario: Missing owner bookmark or moderated content
- **WHEN** the owner bookmark cannot be resolved or its content is moderated
- **THEN** the existing domain error is returned and no share settings are written
