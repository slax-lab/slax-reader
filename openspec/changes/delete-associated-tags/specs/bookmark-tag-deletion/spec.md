# Spec Delta

## Purpose

Define reliable user-visible outcomes for deleting tags from the bookmark tag list when the API uses an empty successful response.

## ADDED Requirements

### Requirement: Successful empty tag deletion closes the modal

When the tag deletion request completes successfully without a response payload, the Web application SHALL close the confirmation modal and remove the tag from the displayed tag list without showing a deletion-failed error.

#### Scenario: API returns an empty successful response

- **WHEN** the user confirms deletion and the delete request completes with HTTP success but no data payload
- **THEN** the modal closes
- **AND** the deletion event is emitted
- **AND** no delete-failed toast is shown

### Requirement: Failed or expired tag deletion is not reported as success

When the request layer reports an expired session sentinel or rejects the delete request, the Web application SHALL keep the tag deletion unconfirmed and SHALL release its loading state without emitting a deletion event.

#### Scenario: Request layer handles an expired session

- **WHEN** the delete request result is the request layer's empty-string session-expiry sentinel
- **THEN** the modal remains available
- **AND** no deletion event is emitted

#### Scenario: Delete request rejects

- **WHEN** the delete request rejects
- **THEN** no deletion event is emitted
- **AND** the loading state is cleared
