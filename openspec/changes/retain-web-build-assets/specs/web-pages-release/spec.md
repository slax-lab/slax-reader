## ADDED Requirements

### Requirement: Releases retain recent build assets for open pages

A Web release SHALL include, besides its own build, the files under `/_nuxt/` emitted by each production deployment that the target project replaced within the last 7 days and by the deployment that was current when that 7-day window began, at their original paths and with their original bytes, so a page loaded from such a deployment can still load its chunks, stylesheets, fonts, images, Worker scripts, and WASM. Each build SHALL publish an index of the files it emitted under `/_nuxt/` with their digests, and recovery SHALL take only files listed in an earlier deployment's index whose bytes match the listed digest. A retained file SHALL NOT replace or conflict with a file of the current build. Files outside `/_nuxt/` SHALL NOT be retained. Recovery failures SHALL warn and SHALL NOT block publication of a valid current build.

#### Scenario: A page from the previous release loads a route chunk

- **WHEN** a page from deployment A is open, deployment B replaces A, and the page then loads a chunk that only A emitted
- **THEN** the chunk is served as JavaScript with A's original bytes

#### Scenario: Several releases follow within the window

- **WHEN** deployments B and C are published within 7 days of A being replaced
- **THEN** C still serves A's files under `/_nuxt/`

#### Scenario: An earlier file conflicts with the current build

- **WHEN** an earlier deployment's file has the same path as a current file but different bytes
- **THEN** the current file is published unchanged and the conflict is reported as a warning

#### Scenario: An earlier deployment cannot be read

- **WHEN** an earlier deployment's index or a listed file is unavailable, returns HTML, or fails its digest
- **THEN** that file is not published, the release warns with the deployment and path, and publication proceeds

#### Scenario: A file is older than the window

- **WHEN** a file was emitted only by deployments replaced more than 7 days ago, other than the deployment that was current when the window began
- **THEN** it is not retained, even if a later release had carried it

### Requirement: Release summaries report build asset retention

The release summary SHALL report, separately for the PowerSync Worker graph and for other `/_nuxt/` build assets, how many files and bytes the current build provides and how many were retained from earlier deployments, how many earlier deployments were fully recovered, and every recovery warning, so an operator can see whether open pages are covered.

#### Scenario: Retention succeeds

- **WHEN** every earlier deployment in the window is recovered
- **THEN** the summary reports their count as fully recovered and lists retained files and bytes

#### Scenario: Deployment addresses require authentication

- **WHEN** earlier deployment addresses answer with an authentication redirect
- **THEN** the summary reports unknown coverage and names the affected deployments rather than reporting an empty history
