# Spec Delta

## Purpose

Keeps collection and collection-comment sync scoped to the authenticated user's subscriptions and the collections they may read, with bounded parameter lookups that do not depend on global table size.

## ADDED Requirements

### Requirement: Bounded collection sync lookups

The collection sync configuration SHALL evaluate parameter lookups only against the authenticated user's active subscriptions and the owners/collections referenced by those subscriptions. It MUST NOT enumerate the global `sr_user` or `sr_user_collection` tables for a parameter lookup.

#### Scenario: Large global user table

- **WHEN** the instance has thousands of active users but the authenticated user has two collection subscriptions
- **THEN** a full sync request succeeds without a `PSYNC_S2305` parameter-result error, and the parameter result count is proportional to the user's subscriptions rather than the global user count

#### Scenario: Large global collection table

- **WHEN** the instance has more open collections than the parameter-result limit but the authenticated user subscribes to a small number of them
- **THEN** the collection bookmarks, statistics, and share settings still sync for the subscribed collections

### Requirement: Collection content authorization gates

The sync configuration SHALL only deliver collection share settings, bookmarks, and bookmark statistics when the subscription is active and not deleted, the collection status is open, and the collection owner is not soft-deleted. The collection list SHALL continue to include the user's non-deleted subscriptions with their status so clients can present closed collections.

#### Scenario: Closed collection

- **WHEN** a collection owner closes sharing for a collection the user subscribes to
- **THEN** the user's collection list still includes the collection with its status, while the collection's bookmarks, statistics, share settings, and on-demand comments stop syncing

#### Scenario: Soft-deleted owner

- **WHEN** a collection owner is marked deleted
- **THEN** the owner's collections stop delivering bookmarks, statistics, share settings, and comments to subscribers immediately, without waiting for the background data cleanup

#### Scenario: Restored owner

- **WHEN** a soft-deleted owner is restored
- **THEN** the owner's open collections become visible to subscribers again

### Requirement: On-demand collection comment authorization

The `collection_bookmark_comment` stream SHALL return comments only for the requested bookmark UUID and owner id when the bookmark belongs to that open collection and the owner is not soft-deleted. Its authorization checks SHALL use the subscription parameters and MUST NOT scan the global user or collection tables.

#### Scenario: Open collection comment

- **WHEN** a client subscribes to a starred bookmark in an open collection whose owner is active
- **THEN** the bookmark's comments sync

#### Scenario: Closed collection or deleted owner comment

- **WHEN** the collection is closed or the owner is soft-deleted
- **THEN** the on-demand comment stream returns no rows

### Requirement: Owner deletion state maintenance

The database SHALL maintain each collection's owner-deletion state transactionally with the owner's deletion state, and SHALL backfill it for existing collections. New collections SHALL inherit the current owner state.

#### Scenario: Owner state changes

- **WHEN** a user is marked deleted or restored, or a collection is created for an owner
- **THEN** the collection owner-deletion state reflects the current owner state without a separate application write
