# Tasks

## 1. Empty-image input filtering

- [x] 1.1 Add zero-size metadata and empty retrieved-body guards in the existing image-selection path, recording `empty` without consuming valid-image slots; verify source tests cover both guards and later valid images.
- [x] 1.2 Add maintenance-level regression coverage proving valid text survives empty images, no empty image reaches the provider, and image-only empty input retains `missing_source_content`; verify existing vector maintenance and source suites pass.

## 2. Verification and delivery

- [x] 2.1 Exercise the actual input generator against the four authorized saved-content samples in a local runtime with read-only content access; record inputs omitted and retained, and explicitly distinguish this from direct Jina response verification.
- [x] 2.2 Run API typecheck, lint, relevant/full tests, strict OpenSpec validation, and four-Worker dry-run build; record results and review Bugs/Security/Compliance in validation.md before delivering the scoped fix as a PR targeting dev.
- [x] 2.3 Apply the human-requested test-only disconnect correction: synchronize in-flight work and actual socket closure, assert downstream embedding abort, no vector queries and exactly one cleanup rather than requiring one particular Request signal path; verify eight consecutive actual Workerd runs without increasing the audit timeout or skipping the test.
