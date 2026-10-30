# Tasks

## 1. Minimal correction

- [x] 1.1 Reproduce the collection header obscuring the guidance in a browser fixture using the source component and header styles, with an overlap hit-test and before capture.
- [x] 1.2 Change only the guidance card z-index from 80 to 1000 for the layering fix and verify that component's diff contains exactly that declaration change.
- [x] 1.3 Reproduce the quoted-tweet hover background and generated 14px description line height using the actual article Sass and UnoCSS configuration.
- [x] 1.4 Apply the approved theme accent hover background and 20px description line height only in the Web article tweet stylesheet.

## 2. Verification and delivery

- [x] 2.1 Run focused existing guidance tests and applicable static checks; exercise overlap, scrolling, close and drag behavior in a browser at 320px, 390px, 768px and desktop widths in light, dark and e-ink themes, and record results and limitations in validation.md.
- [x] 2.2 Obtain human hands-on acceptance of the guidance in the prepared running environment and record who accepted, the date, and any requested adjustments.
- [x] 2.3 Compile and exercise the quote-card correction in light, dark, and e-ink at 320px, 390px, 768px, and desktop widths, including multiline English and Chinese content and link activation; record evidence and obtain human hands-on acceptance.
- [x] 2.4 Complete the Bugs, Security and Compliance pre-push review, refresh the base when GitHub connectivity permits, and open one PR to dev using the repository template with before/after visual groups for both corrections.
- [x] 2.5 Record the maintainer's explicit decision to keep uniform layer 1000 above in-page overlays, verify that intended precedence and the absence of route-specific treatment, and update the existing PR's review evidence.
- [ ] 2.6 After the task PR merges, classify any unfinished tasks and archive this change through a separate documentation PR.
