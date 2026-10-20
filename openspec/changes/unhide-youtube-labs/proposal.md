# Proposal

## Why

Web Settings > Labs hides the YouTube videos (`youtube`) and YouTube AI articles (`youtube_article`) rows. Both features are complete and ship behind their Labs switches. Keeping the controls hidden prevents accounts that never opted in from enabling them, while the disabled-save message still sends those accounts to a `/user#labs` card that cannot show the switch. YouTube saving and AI articles have been in production long enough to be selectable like the other Labs features.

## What Changes

- Show the `youtube` and `youtube_article` Labs rows in Web Settings with the same labels, order, and enable/disable behavior as every other row.
- Remove the key-based hiding predicate entirely. Labs visibility is driven only by the account's Labs response and the presence of a translated name; PDF has been visible since `extension-support-pdf`.
- Keep authorization unchanged: the backend `youtube` acquisition gate, stored enablement and timestamps, and access to existing bookmarks are untouched.
- Add a delta to `settings-labs-visibility`, replacing the temporary hidden-control requirement with translated-row visibility, and reconcile the still-unarchived `youtube-ai-article` delta that requires the AI-article row to stay hidden.
- Remove the now-superseded `settings-labs-visibility` delta from the completed but unarchived `extension-support-pdf` change, so only this change modifies that capability and either archive order stays coherent.

## Capabilities

### Modified Capabilities

- `settings-labs-visibility`: every translated Labs row is visible; the Labs card and Features navigation follow the translated rows in the response.

## Impact

- Web presentation and tests: `apps/web/app/composables/useLabFeatures.ts`, `apps/web/app/components/UserLabSection.vue`, `apps/web/app/pages/user.vue`, and their unit tests.
- OpenSpec: this change, the unarchived `youtube-ai-article` spec delta, and the superseded `settings-labs-visibility` delta removed from `extension-support-pdf`.
- No API, contract, database, dependency, Extension, or Mobile changes. Save/upload gating and existing preferences keep their current behavior.
