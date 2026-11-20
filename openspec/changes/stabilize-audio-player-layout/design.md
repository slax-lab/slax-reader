# Minimal design

## Audio layout

Keep PodcastProcessor's existing insertion and cleanup unchanged. Its player remains a direct sibling before the article container, outside the highlight engine and sticky over original/translated content. Snapshot-scoped CSS reserves its normal box through article padding and offsets the sibling's occupied flow space. The same layout predicate matches the native marker or enhanced host, so the reservation survives enhancement. Position the native controls in that space without hiding or deferring article text. Derive the resting height from the existing metadata line, metadata gap, play control and card padding/borders; allow enhanced errors/follow controls to grow naturally.

The empty PodcastBar live region stays mounted. Only a section with no status text and no translation switch loses its otherwise empty bottom margin. Nonempty states retain their existing styling and announcements.

## Content request logs

A small ContentTiming utility follows the existing NewsletterTiming structured-console convention and is shared by Edge/Core. Instantiate it only for GET /content/meta. Log an entry marker and a response summary, including the existing duration map, status, scope, module nonce and observed metadata-request ordinal. Generate the module nonce lazily during a request, not in global scope. Forward the platform CF-Ray using the existing internal Ray header so the same request can be correlated across boundaries. Request-local timing maps remain request-local.

Emit these bounded summaries in all environments so production waits can be investigated after the normal release. Preserve the existing non-production-only Server-Timing headers. On an Edge binding rejection, emit a failed summary from finally and propagate the same error. No retry or new public diagnostic endpoint is added. An observed module's first metadata request is not necessarily its first invocation; neither those logs nor frozen JavaScript clocks establish platform scheduling duration or synchronous initialization CPU.

## Verification

Source-compiled browser checks compare article/introduction positions before and after real PodcastProcessor enhancement and real PodcastBar mounting, including native fallback, sticky scrolling, light/dark/e-ink and 390/768/1440px layouts. Exercise real mark rendering, image preview and native media play/seek/persisted resume. Unit tests cover structured fields, reused module identity, error propagation, missing Ray IDs, prod response invariance and Ray forwarding. Retain a full-reader local acceptance page and record all actual results and gaps before the draft PR.
