# Tasks

## 1. Port the paired fixes

- [x] 1.1 Port the API collection regressions from #871, verify the failures on v2, then port the style helper and hook integration and pass the focused tests with the installed Readability.
- [x] 1.2 Port the Web regressions from #1619, verify the failures on v2, then port display-size detection and frame exclusions while retaining v2 resize scheduling; pass all image processor regressions, including maximum-only constraints.

## 2. Validate and publish

- [x] 2.1 Run Web article processor/integration tests, API tests, relevant lint/type checks, and OpenSpec strict validation; record results and independently confirm any baseline failures.
- [x] 2.2 Verify API-produced markup with the actual Web image processor and article styles at narrow mobile, 768px, and desktop across light, dark, and e-ink; record icon sizes, proportional large images, height-only constraints, frames, and resize behavior.
- [ ] 2.3 Complete the local Bugs, Security, and Compliance review against this change and resolve Important findings; create one PR targeting dev with the pinned source commits and v2 validation evidence.
