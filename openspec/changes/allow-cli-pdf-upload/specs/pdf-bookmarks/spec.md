## ADDED Requirements

### Requirement: PDF upload with a Reader API key

The API SHALL accept a valid Reader API key on POST /v1/bookmark/upload_pdf and SHALL apply the existing PDF upload rules to the account that owns the key.

#### Scenario: Opted-in owner uploads a valid file

- **WHEN** an account with PDF Labs enabled submits valid PDF bytes to the upload endpoint using its active Reader API key
- **THEN** the endpoint returns the existing PDF upload receipt for that account's bookmark

#### Scenario: Upload eligibility and validation

- **WHEN** the key owner has PDF Labs disabled or submits a file that fails existing PDF validation
- **THEN** the endpoint returns the applicable Labs or validation error and creates no successful bookmark

#### Scenario: Scope of the route grant

- **WHEN** a caller supplies an invalid key, a different HTTP method, or a child path under the PDF upload route
- **THEN** the new POST route grant does not authorize that request
