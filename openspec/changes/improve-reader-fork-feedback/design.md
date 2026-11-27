# Design

## Context

The public reader currently puts SnapshotForkButton beside Share. Its 13px muted text, 14px outline star and transparent surface give it the same priority as a secondary tool. useBookmarkFork combines pending and successful copies. The add_url acknowledgement can have an empty bookmark ID. It cannot prove copied content is ready. Native LibraryScreen.ContinueBanner provides the reference for a non-blocking surface above the safe area.

## Goals / Non-Goals

The reader should be able to identify the destination before acting, continue reading throughout copying, and distinguish a saved copy from a sent email. The scope is mobile Web and desktop Web. The native app, import behavior, OTP flow and the existing authorized copy operation keep their current responsibilities.

## Decisions

### Placement, copy and motion

Keep one action controller across viewport changes. Desktop uses an accent-filled header action beside Share. Mobile uses a single bottom card with a left-aligned reason and right-aligned action. Avoid a scrim or focus trap. Integrate the card with the existing mobile bottom toolbar area, offset the notes entry and player controls using actual occupied height, and yield to an open panel or login dialog. Add end-of-article space including safe area so the last line remains reachable.

| Stage | Desktop | Mobile card |
| --- | --- | --- |
| Ready | 稍后再看 / Save for later | 把这篇文章存起来 / Save it for later · 稍后再看 / Save |
| Working | 正在保存… / Saving… | 正在保存文章… / Saving this article… |
| Confirmed | 文章已保存 / Article saved · 已存文章 / Saved articles as a text link | Same confirmation and secondary action |
| Receipt accepted | 也发了封邮件，方便之后找回这篇文章。 / We also sent an email so you can find your way back. | Same wording in the success card |
| Failure | 未能保存这篇文章 / Couldn’t save this article · 重试保存 / Try again | Explain the actionable cause and offer retry |
| Revisit | Filled star and compact saved status | Compact header status, with the bottom area released |

Use the existing outline and filled star pair, clear text, Web theme tokens and one short fill/scale transition on confirmed success (about 200 ms). The working state is immediate with no artificial delay. If saving finishes quickly, do not delay it to show a spinner. Keep confirmation available in the current reading session, with a quiet text link to /bookmarks and a dismissible desktop popover. Suppress motion in e-ink and reduced-motion modes. Keep status announcements independent of decorative animation and preserve keyboard focus on state changes. Touch targets are at least 44px. Update DESIGN.md §7.5 during implementation.

Use the reader's paper surface and a folded bookmark for the copy status. Its outline star changes to a progress arc, then fills on success. Reserve the filled treatment for the ready and retry actions. Use a compact saved indicator in the desktop header. Group the title and supporting text beside the paper artwork. When the provider accepts the receipt, replace the return guidance with the email line. On both layouts, the saved-articles action uses muted, underlined text and has no button fill.

Center the four marks inside the folded bookmark silhouette so its visual spacing holds at the narrow viewport. Anchor desktop feedback below the header rule with a physical gap. Fit the desktop progress popover to its content and center the icon, single status line and close control in one compact row. On mobile, move the card upward as the dock fades in and reverse the motion on exit. A pointer-transparent gradient fades article content above the card and reaches the reading background at the card edge, independent of the card height. The solid reading background continues behind the card and through the device safe area. The notes entry uses the shared lower backdrop while the card is visible. During exit the surface releases focus and pointer input, and the e-ink and reduced-motion presentations use static state changes.

### Resolve publication separately from admission

Track submitting, accepted/processing, confirmed and retryable states scoped to viewer, source and the current save attempt. Resolve the initial state from authenticated viewer metadata. While processing, use bounded, visibility-aware metadata-only refresh through the existing authorized metadata path, avoiding repeated article-body downloads. Reconcile again on foreground or explicit status refresh after the bounded window. Transient inability to read status leaves the copy processing. Stop observers on route/account change. A fresh login continuation may arrive after copying already finished. Preserve the explicit save intent across that return so a new completion can still be distinguished from an ordinary revisit.

### Send and report a receipt from the server

Identify public reader intents in submitBookmarkFork, including finishSnapshotSave. Keep the marker optional on the shared add_url contract. Use the server account, source and authenticated admission timestamp, including first admission after sign-in. Compare with sr_user.created_at using elapsed time, with an exclusive 24-hour upper bound. Preserve eligibility across asynchronous copying. Validate reader URL, source authorization and ownership through the normal Fork path. A client never supplies the recipient or decides age eligibility.

Record the qualified receipt alongside successful publication using an additive receipt record keyed by recipient account and source relation. Bind dispatch to the original admission and show the receipt only for its matching publication. This is needed to remember delivery across workflow replays, and to let the same viewer subsequently see the provider's acceptance. A reused destination for a new source can qualify, including a retry after copy failure. Do not gate on a created disposition alone. Dispatch through the existing workflow with a separate delivery step and a stable provider idempotency key. A skipped copy step or replay after commit must still be able to finish its pending receipt without copying the article again. Handle provider failure independently of bookmark state. No new bulk mail service or campaign scheduler is needed.

Resolve a deliverable account email using existing verified identity rules, preferring an active email binding. Skip synthetic placeholders and preserve genuine deliverable provider or relay addresses. Use the same sender, Resend transport, text payload and locale conventions as verification codes. Store no recipient address in the public projection. Extend private viewer metadata with the minimum delivery signal for this source/save. Expose only to the authenticated actor. While its confirmation is open, reconcile pending mail separately from copy status. Only provider acceptance can produce the sent line. Do not infer inbox delivery from acceptance.

### Receipt copy for review

| | Simplified Chinese | English |
| --- | --- | --- |
| Subject | Fork 成功，文章已保存 | Fork Success — your article is saved |
| Body | 已经把《{title}》存好了。想看的时候，打开 Slax Reader 就能找到。 | You now have your own copy of “{title}” in Slax Reader. When you’re ready to keep reading, you’ll find it in your bookmarks. |
| Plain-text navigation | 打开 Slax Reader → https://r.slax.com/ | Open Slax Reader → https://r.slax.com/ |

Use “已经把这篇文章存好了。” or “You now have your own copy of this article in Slax Reader.” for a missing title. Keep the link address fixed and the article title in the plain-text body. The link opens Slax Reader's home, while the optional link in the success surface opens saved articles.

## Risks / Trade-offs

- Source pages can load before viewer metadata. Keep the CTA unavailable until the viewer state is known.
- The existing confirmation that delivery failed can be ambiguous after a transport timeout. Use the same key for bounded provider retries and claim sent only on documented provider acceptance.
- Mobile notes and podcast/PDF controls may occupy the same edge. Exercise coexistence with actual content, long localized strings, open panels and the narrowest supported viewport before shipment.
- For rollout, ship additive persistence, optional input and viewer metadata first, followed by Web. Older clients can omit the marker. A Web rollback stops new marked requests and previously accepted work can finish.
