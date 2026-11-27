# Make saving a shared article visible

## Why

Readers overlook the small star beside Share and cannot tell whether it creates their own copy. The current control also reports a saved article while the server may still be copying it.

## What Changes

- Give eligible visitors to the public Web reader a primary save button in the desktop header and a non-blocking bottom card on mobile Web. The card explains the personal copy on the left and offers the action on the right.
- Keep the reader on the source throughout submission, background copying, completion and retry. Confirm completion in place, with a deliberate transition, read-later wording, and a quiet optional link to saved articles.
- Send a localized transactional receipt for each distinct article successfully saved by a public reader button click initiated during the account's first 24 hours. The change requester confirmed one receipt per article, including when multiple different articles succeed on the same day.
- In the success confirmation on both layouts, add an email-sent line once the mail provider accepts the message for the current reader and article. Show article success immediately, including when mail is delayed or unavailable.
- Carry the same intent across the existing sign-in continuation. Keep ordinary URL adds and batch imports outside this email trigger.

## Capabilities

### New Capabilities

- `new-reader-fork-receipts` covers eligibility, delivery and wording for the first-day receipt.

### Modified Capabilities

- `snapshot-save-presentation` covers responsive placement, distinct processing and success states, and accessible feedback.

## Impact

Web public reader, localized strings, save continuation, DESIGN.md §7.5, API admission and publication, recipient resolution and the existing Resend transport. The native app's Continue Reading banner is a visual reference. The existing bookmark-fork capability continues to own admission, authorization and copy semantics.

## Review status

The change requester approved implementation on 2026-11-27 after reviewing the desktop and mobile mockups and interactive prototype. The preview covered ready, processing, success, delayed receipt, failure, unavailable, owner and already-saved states, with theme controls for light, dark and e-ink. The requester retained the primary desktop action and non-modal mobile card, confirmed one receipt per successful article, and asked for a sent-email line in both success layouts. Production styling should refine hierarchy, density and transitions from the preview using the Web design contract. Running-environment visual verification covers desktop, the 768px transition and 320px.

The change requester requested a visual refinement on 2026-11-27. The follow-up keeps the existing desktop and mobile placement, and asks for quieter feedback that better fits the reading page. The revised component reduces surface elevation, gives the active save command the strongest emphasis, and removes duplicate success copy. Hands-on acceptance covers the revised visual treatment.

The change requester identified tight icon spacing, a desktop popover aligned against the header rule, and missing mobile entrance, exit and lower background treatment. The follow-up adds breathing room and applies the native Continue Reading banner's motion and fade pattern using Web theme tokens. The behavior remains within the approved public-reader placement.

The change requester asked for a visibly longer lower fade, a more distinctive copy symbol, and a new desktop action and confirmation layout. The revision uses the Web reading palette with a longer gradient above the card, component-owned paper artwork, and a separate bookmarks action row.

The change requester asked to refine the earlier bookmark ribbon silhouette. The latest icon uses a folded corner and a rounded notch within that silhouette.

The change requester reported the lower backdrop was still hard to see. The existing backdrop now extends farther into the reading area and reaches the reading background at the card edge, independent of card height.

The change requester clarified that readers save the shared article so they can come back and finish it later. Use natural language focused on that intent, avoid internal destination names in the save and receipt feedback, and make the existing destination link secondary to the confirmation.

The requester preferred “稍后再看” for the Simplified Chinese action. Use conversational wording with “看” across the Chinese save feedback and receipt.

Keep the in-progress copy to the save status. The reader can continue using the article while the save runs.

The requester asked for a compact desktop progress popover and clearer confirmation wording. Align the single progress line with its icon and close control, and confirm the outcome directly with “文章已保存”.
