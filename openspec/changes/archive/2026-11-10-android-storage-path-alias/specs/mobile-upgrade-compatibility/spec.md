# Spec Delta

## ADDED Requirements

### Requirement: Android storage admission tolerates equivalent application-root aliases

Android saved-data admission SHALL treat operating-system path aliases of the same trusted application data root as equivalent. A legitimate ancestor alias MUST NOT prevent a new installation from opening its expected database slot or an existing installation from reopening its verified database. Resolution SHALL preserve the established database identity and exclusive ownership policy. Redirected application child directories, paths outside the trusted root, invalid stored identities, and missing established databases MUST continue to enter recovery without deleting original files, resetting preferences, discarding pending operations, or silently opening a replacement database.

#### Scenario: A new installation starts through an application-root alias
- **WHEN** Android supplies an application data path through a legitimate ancestor alias and the expected database directory does not yet exist
- **THEN** startup resolves the expected slot within that same application root and continues normal initialization
- **AND** differing equivalent path spellings do not trigger directory recovery

#### Scenario: An established native database reopens through an application-root alias
- **WHEN** a ready installation binding identifies the existing native database and Android exposes the same application root through an equivalent ancestor alias
- **THEN** startup verifies and reopens that same database
- **AND** stored data, pending operations, and the binding retain their existing identity

#### Scenario: A previously adopted legacy database reopens through an alias
- **WHEN** a valid adopted installation identifies the existing legacy database and the application-root path spelling changes only through a legitimate operating-system alias
- **THEN** startup resolves the same legacy database and retains its verified identity and queued operations
- **AND** no fresh database is substituted

#### Scenario: An application child directory is redirected
- **WHEN** the files directory or expected database directory is redirected away from its designated slot, whether inside or outside the application root
- **THEN** admission fails safely and exposes recovery
- **AND** the application does not initialize or modify a database at the redirected target

#### Scenario: An established database cannot be verified
- **WHEN** the established database is missing, its file is redirected, or its stored owner or identity does not match
- **THEN** startup retains the existing recovery behavior and original remaining files
- **AND** alias compatibility does not authorize bypassing verification or creating an empty replacement

#### Scenario: A development-fresh startup uses the same application-root alias
- **WHEN** the explicitly selected development-fresh mode starts through a legitimate ancestor alias
- **THEN** it resolves the same expected native directory without an alias-only recovery failure
- **AND** ordinary startup retains its exclusive ownership requirement; development mode does not become a fallback for failed production admission
