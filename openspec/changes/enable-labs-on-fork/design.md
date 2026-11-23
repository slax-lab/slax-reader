## Context

`BookmarkForkService.admit` currently checks Labs before reserving the online destination. Workflow execution and the synchronous `fork` path also check Labs during copying. Both publishing paths already call `BookmarkForkRepo.publish`. `LabService.features()` owns feature keys and lifecycle status, and `LabRepo` owns the stored user preferences.

## Goals and Scope

- Keep one declarative source for eligibility and reuse one activation path for all matching formats and Fork entry points.
- Keep the work within the existing Fork and Labs services and repositories. Reuse the current request handling, dispatch order, copy implementations, database schema, and Settings API.

## Decisions

### Declare eligibility in the existing Labs definitions

Add one optional content-kind field to `LabFeatureDef`. Register the three current matches in `LabService.features()` and resolve the matching active Lab through a single method. The feature key comes from its registry entry. Adding a rule for an already recognized content kind requires changing only its Lab definition. A separate Fork map would duplicate feature ownership across services.

Reuse the PDF format marker and the media kind produced by `MediaSnapshotService.copyForFork`. Historical YouTube video snapshots without a media reference use the existing YouTube video URL rule. Keep that fallback limited to a registry entry opted into Fork activation. Ordinary HTML and URL shortcuts have no match, and a filename suffix or podcast provider URL alone cannot select an activation rule.

### Publish and enable in one transaction

Replace the existing Fork-specific Labs denial checks. Preserve the flow from handler to `BookmarkService` and `BookmarkForkService`, through the existing admission and Workflow for online saves or the synchronous copy path. Both copy paths resolve the Lab through the same domain method and pass at most one optional feature key to `BookmarkForkRepo.publish`. Source access, revision, moderation, and destination write-claim checks continue at their current boundaries.

`BookmarkForkRepo` owns the publication transaction. Use a focused write in `dbLab.ts` that accepts that transaction and enables the destination user's matching row using the existing `(user_id, feature)` key. Preserve the existing timestamp when the row is already enabled. Run the write on the successful publication path for both inserts and refreshes. The settings operation currently opens its own transaction and takes a user-row update lock. Calling it inside Fork publication would make it wait on the shared user lock already held by publication.

Enabling during admission would change the account even when the copy subsequently fails. Enabling after the publication commit could leave a successful copy and a disabled Lab if the settings write fails. The existing publication transaction covers both database changes without extending the copy or dispatch protocol.

## Verification

The existing Fork HTTP smoke already exercises real Workflow dispatch and publication. Extend it to check Labs before and after publishing eligible and ordinary copies and after a failed copy. Use existing service and repository tests for the registry rule, synchronous publication, and transaction rollback.
