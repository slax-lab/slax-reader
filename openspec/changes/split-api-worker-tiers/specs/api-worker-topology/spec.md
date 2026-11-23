## Purpose

Define which API Worker owns each entry point, route, binding and Durable Object class, where each Worker executes, and how the deployment preserves live state when ownership moves, so that each Worker loads only its own code and database-facing work runs beside the primary database.

## ADDED Requirements

### Requirement: Each API Worker has a fixed responsibility

The API SHALL deploy five Workers with these responsibilities:

- **Edge** SHALL be the only publicly routed API Worker. It SHALL handle CORS preflight, JWT authentication, rate limiting, the image proxy and cacheable responses, and the `ContentEntry` RPC used by the Web application, and SHALL forward every other request to Core or AI with the existing signed edge identity. API-key requests SHALL be forwarded unauthenticated by Edge and authenticated by the receiving Worker, as today. Edge SHALL remain every queue's consumer, the owner of the cron triggers and the Email Routing target, and SHALL forward each queue batch, scheduled event and inbound email unchanged to Core without running a handler itself.
- **AI** SHALL serve the AI routes: `/v1/aigc/summaries`, `/v1/aigc/chat`, `/v1/bookmark/overview`, `/v1/bookmark/outline`, `/v1/bookmark/search`, `/v1/search`, `/v1/recommendations/*`, `/v1/bookmark/vector/refresh`, `/v1/bookmark/preference/refresh`, `/v1/collection/vector/refresh` and `/v1/collection/preference/refresh`, and the `AiEntry` vector RPC.
- **Core** SHALL serve every other Reader HTTP route, and SHALL run every queue, cron and inbound email handler for the events Edge forwards, and SHALL own every Workflow class and the `VectorPreferenceObject` Durable Object class.
- **Objects** SHALL own the `SlaxJieba`, `ScreenshotBrowser` and `SlaxWebSocketServer` Durable Object classes and SHALL answer every HTTP request to its own `fetch` with not found.
- **Browser** SHALL continue to own the `SlaxBrowser` Durable Object.

The API SHALL NOT serve `/v1/mcp/*`; requests to it receive the existing not-found response.

One route list SHALL define the AI routes for both Edge forwarding and route generation. Only Edge SHALL have routes or custom domains. HTTP responses, status codes, headers and error envelopes MUST remain unchanged for every route.

#### Scenario: An authenticated Reader request is served
- **WHEN** a client calls a non-AI Reader route with a valid token
- **THEN** Edge authenticates and rate-limits it, forwards it to Core, and the response is unchanged

#### Scenario: A search request is served
- **WHEN** a client calls `/v1/search` or a recommendation route
- **THEN** Edge forwards it to AI and the response is unchanged

#### Scenario: A queue message, cron tick, email or Workflow step runs
- **WHEN** Cloudflare delivers a queue batch, a scheduled event or an inbound email to Edge, or resumes a Workflow instance
- **THEN** Core runs the handler or the Workflow step; Edge only forwards the event and has no Workflow class

#### Scenario: A forwarded queue batch settles its messages
- **WHEN** Core's queue handler acknowledges some messages and retries others
- **THEN** Edge applies the same acknowledgement and retry, with the requested delay, to the delivered batch, and a failure of the forwarded call leaves the batch to the queue's retry policy

#### Scenario: A forwarded email is rejected
- **WHEN** Core rejects an inbound newsletter email
- **THEN** Edge rejects the delivered message with the same reason, and an admission failure in Core fails the delivery

#### Scenario: A WebSocket notification connection is opened
- **WHEN** a client upgrades `/v1/user/messages`
- **THEN** Core authenticates it and hands it to the `SlaxWebSocketServer` object owned by Objects

### Requirement: Each Worker bundles only its own code

Each Worker's published bundle SHALL contain only the modules reachable from that Worker's own entry point.

- Edge MUST NOT contain the dependency registry, Prisma clients or query compilers, Workflow, queue, cron, email or Durable Object implementations, or any WebAssembly module.
- Core and AI MUST NOT contain the `SlaxJieba`, `ScreenshotBrowser` or `SlaxWebSocketServer` implementations, the jieba WebAssembly module, the puppeteer library or any MCP library, and each MUST register only the dependency classes reachable from its own handlers. AI MUST NOT contain Core's router, consumers, cron jobs or Workflow classes.
- A Worker that still has a retired Durable Object namespace MAY export a stub class of that name whose methods carry no behavior, so the namespace is kept without its implementation.
- Objects MUST NOT contain the dependency registry, routers, Workflow, queue, cron or email handlers.

Callers outside a Durable Object's owning Worker SHALL reference the class only as a type. A controller SHALL serve routes of only one Worker; route generation MUST fail when a controller mixes AI and Core routes. The test suite SHALL fail when a Worker's bundle violates these rules.

#### Scenario: Edge is built
- **WHEN** the API build produces the Edge bundle
- **THEN** the bundle contains no WebAssembly module, Prisma client, Workflow class or Durable Object class

#### Scenario: A controller gains a route for the other Worker
- **WHEN** a route belonging to AI is added to a controller that also serves Core routes
- **THEN** route generation fails and names the controller

#### Scenario: AI is built
- **WHEN** the API build produces the AI bundle
- **THEN** the bundle contains no capture, import, Passkey, Telegram, Stripe, newsletter or PDF-text implementation

#### Scenario: A change makes Core import a stateless Durable Object
- **WHEN** a Core-reachable module imports `SlaxJieba`, `ScreenshotBrowser` or `SlaxWebSocketServer` for its runtime value
- **THEN** the test suite fails and identifies the Worker and module

### Requirement: Workers run in fixed locations

The deployment SHALL publish an explicit placement region, defined once by the API deployment script as the cloud region nearest the primary PostgreSQL database (`aws:ap-southeast-1`), for Core, AI and Objects. Edge and Browser MUST be published without placement so they run in the location nearest the request. Local development MUST NOT apply placement. Private configuration that declares placement at the top level or in the selected environment MUST be rejected before any remote operation, with a message naming the deployment script as the owner of placement.

#### Scenario: Generated remote configuration
- **WHEN** remote configuration is generated for any environment
- **THEN** Core, AI and Objects carry `placement.region = "aws:ap-southeast-1"`, and Edge and Browser carry no placement

#### Scenario: Private configuration sets placement
- **WHEN** the selected private configuration contains a `placement` table
- **THEN** validation fails before any remote operation and states that placement is owned by the deployment script

#### Scenario: Local development
- **WHEN** Workers are started locally
- **THEN** no generated configuration carries placement

### Requirement: Ownership moves preserve live state

Moving ownership onto this topology SHALL preserve existing data and in-flight work:

- Workflow names, class names and instances SHALL be preserved when Workflow ownership moves from Edge to Core; no Workflow MAY be deleted or renamed.
- The stateless Durable Objects SHALL be created as new classes in Objects. The existing `SlaxJieba`, `SlaxWebSocketServer` and `ScreenshotBrowser` namespaces in Core and Edge SHALL be retained behind stub classes rather than deleted. The `VectorPreferenceObject` namespace SHALL remain in Core unchanged.
- The removed MCP server's `SlaxMcpServer` namespaces in Core and Edge SHALL be deleted, with their stored sessions, by the first release that finds them, after the new Core is published and once Edge no longer binds Core's namespace. No other Durable Object namespace MAY be deleted.
- Queue consumers, cron triggers and the Email Routing target SHALL NOT move; every queue SHALL keep its single existing consumer.

Existing installations SHALL reach this topology through a normal release, without a manual transition step. Before its first publication a remote release SHALL stop while any API Worker lacks a value its code reads that another API Worker of the installation holds, naming the Worker and key and never the value, and SHALL choose a publication order from the account state that publishes Core before AI and deletes the MCP namespaces as above. New installations SHALL deploy directly into this topology through bootstrap.

#### Scenario: A Workflow instance is running during the first release
- **WHEN** a Workflow instance created before the first five-Worker release resumes after Core takes ownership
- **THEN** it continues from its last completed step under the same Workflow name

#### Scenario: A preference ledger exists before the first release
- **WHEN** a preference refresh addresses an existing `VectorPreferenceObject` after the first five-Worker release
- **THEN** Core serves it with its previously stored state

#### Scenario: The first release completes
- **WHEN** the first five-Worker release finishes
- **THEN** no `SlaxMcpServer` namespace remains on Core or Edge, and later releases publish each Worker once

#### Scenario: A client calls the removed MCP endpoint
- **WHEN** a client requests `/v1/mcp/sse`
- **THEN** the API returns the existing not-found response

#### Scenario: A Worker lacks a value its code reads
- **WHEN** a release finds a key that a Worker reads, another API Worker holds and neither that Worker nor the selected `[vars]` provides
- **THEN** it stops before the first Worker publication and names the Worker and key

#### Scenario: A release adds a cron schedule or a queue
- **WHEN** a release adds a cron schedule or a consumer for a new queue
- **THEN** Edge's publication creates it and no precondition requires it in advance
