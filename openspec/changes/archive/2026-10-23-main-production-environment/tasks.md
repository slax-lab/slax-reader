# Tasks

## 1. Workflow and documentation

- [x] 1.1 Select API's GitHub Environment directly from the merged base branch; verify dev/beta/main all select their own environment and Web already follows the same mapping.
- [x] 1.2 Update the API operating guide; verify it distinguishes main GitHub settings from unchanged api/prod.toml and runtime values.

## 2. Verification

- [x] 2.1 Parse both workflows and compare API against its baseline; verify only jobs.deploy.environment changes and no application, script, template, configuration, or test code is modified.
- [x] 2.2 Run strict OpenSpec validation and the REVIEW.md Bugs/Security/Compliance passes; verify the diff matches the human's narrowed scope and record the results.
