# Zhihu Capture Spec Delta

## Purpose

Let users save available Zhihu question, answer, article, and pin content despite partial provider failures, without discarding successful content or publishing empty captures.

## ADDED Requirements

### Requirement: Assemble question captures from independently available parts

For a supported question URL, the system SHALL obtain question detail and the first answer-list page independently. It SHALL retain every successful response while retrying the failed part, then assemble the available question description followed by usable answers in provider order. It SHALL omit unavailable parts and unusable answer entries without adding error placeholders to the article. The existing first-page limit of 20 answers SHALL remain unchanged.

#### Scenario: Question detail unavailable and answers available
- **WHEN** question detail remains unavailable after its retry budget and the answer list contains usable bodies
- **THEN** the capture succeeds with those answers, using an available question title from the answers or a neutral Zhihu question title
- **AND** the unavailable question description is omitted

#### Scenario: Answer list unavailable and question description available
- **WHEN** the answer list remains unavailable after its retry budget and question detail contains a usable description
- **THEN** the capture succeeds with the question title and description without answer sections

#### Scenario: Both parts available
- **WHEN** question detail and the answer list both succeed
- **THEN** the capture preserves the description, usable answers, author metadata, images, and answer order supplied by the existing capture path

#### Scenario: Some answer entries lack usable bodies
- **WHEN** the answer-list response contains both usable and empty or malformed answer entries
- **THEN** the capture includes the usable entries without letting an unusable entry discard the others

### Requirement: Retry only failed Zhihu requests within one bounded budget

Each requested Zhihu endpoint SHALL have at most four attempts per capture execution, with waits of 1, 2, and 4 seconds before successive retries of transient failures. TikHub's generic upstream HTTP 400 failure, transport failures, request timeouts, malformed responses, and HTTP 408 or 5xx responses SHALL use this budget. Each attempt SHALL finish or time out within 20 seconds, including response-body consumption. Successful responses MUST NOT be requested again because another part fails. Authentication, permission, billing, rate-limit, explicit not-found, and invalid-parameter failures SHALL stop that part without blind retries. Exhaustion SHALL NOT start another whole-provider retry cycle in the surrounding crawl workflow.

#### Scenario: Transient failures recover
- **WHEN** one part fails twice with TikHub's generic HTTP 400 and succeeds on its third attempt
- **THEN** it is requested three times with waits of 1 and 2 seconds and its successful content is included
- **AND** no fourth request is made

#### Scenario: One part succeeds while the other exhausts retries
- **WHEN** the answer list succeeds immediately and question detail fails on all four attempts
- **THEN** the answer list is requested once and question detail four times
- **AND** the successful answer content remains available for assembly

#### Scenario: All parts exhaust their retry budgets
- **WHEN** neither question part becomes available after four attempts each
- **THEN** the capture fails after at most eight provider calls
- **AND** surrounding workflow retries do not restart these exhausted calls

#### Scenario: Non-transient or rate-limit response
- **WHEN** a part receives HTTP 401, 402, 403, 404, 422, or 429, or an explicitly equivalent provider error
- **THEN** that part stops after that response without spending its remaining retry budget
- **AND** an independently successful part remains eligible for assembly

#### Scenario: A request or response body stalls
- **WHEN** a Zhihu request or response-body read does not complete within 20 seconds
- **THEN** that attempt is cancelled and treated as a transient failure within the same four-attempt budget

### Requirement: Preserve the requested content identity

A single-answer, column-article, or pin URL SHALL retain its existing endpoint and use the same bounded retry policy. The system MUST NOT replace an unavailable requested answer with different answers or convert a single-answer URL into a whole-question capture. Identifier strings MUST remain exact. Usable content blocks and optional metadata SHALL be preserved without requiring unavailable optional fields. Other platforms' capture and retry behavior SHALL remain unchanged.

#### Scenario: Exact answer remains unavailable
- **WHEN** the requested single-answer detail fails through its retry budget
- **THEN** the capture fails without substituting content from other answers

#### Scenario: Optional fields or pin blocks are missing
- **WHEN** an answer or article has a usable body but lacks optional author information, or a pin has both usable and unusable blocks
- **THEN** the available body or usable blocks are retained without fabricated metadata

#### Scenario: Large identifier
- **WHEN** a URL contains an identifier larger than JavaScript's safe integer range
- **THEN** provider requests use the exact identifier string extracted from that URL

#### Scenario: Another platform fails
- **WHEN** a non-Zhihu capture fails
- **THEN** its existing retry, fallback, and failure-handling behavior is unaffected

### Requirement: Never publish a capture with no usable body

A partial capture SHALL succeed only when its combined body contains readable non-whitespace content or supported nonempty media. Titles, author metadata, counts, and empty markup alone MUST NOT qualify. A valid empty answer list SHALL NOT be fabricated into content. When nothing usable remains, the system SHALL use the existing failed-capture lifecycle without publishing a successful empty body or continuing success post-processing. Image-only content supported by the current capture path SHALL remain eligible.

#### Scenario: Only a title survives
- **WHEN** question detail provides only a title and the answer list is empty or unavailable
- **THEN** the capture is marked failed rather than publishing the title as its entire body

#### Scenario: Supported image-only body
- **WHEN** the surviving question description or pin content contains a supported image with a usable source but no prose
- **THEN** the capture is not rejected merely for lacking text

### Requirement: Record safe partial-failure diagnostics

For an omitted or exhausted part, operational diagnostics SHALL identify the Zhihu endpoint, attempt count, HTTP or provider code when available, and provider request ID when available. They MUST NOT expose credentials, authorization headers, raw provider payloads, or response bodies. Partial successes SHALL continue through the existing successful capture lifecycle; no new user-facing error block SHALL be inserted into saved content.

#### Scenario: Provider returns a generic error with request ID
- **WHEN** a Zhihu part exhausts retries and the provider includes a request ID
- **THEN** diagnostics preserve that ID and the endpoint/status context without serializing the raw response
- **AND** any retained article content contains no diagnostic text
