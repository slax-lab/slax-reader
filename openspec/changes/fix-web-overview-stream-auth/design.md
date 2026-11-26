# Design

## Context

The Web overview endpoint returns progress frames once streaming starts. Authentication failures can occur before stream setup and return an ordinary HTTP 401 JSON envelope. The Web shared client currently checks status for JSON requests and returns a reader immediately for streams. The overview panel starts that reader without awaiting it.

## Goals / Non-Goals

- Align overview fetching with the same eligibility used to display the section.
- Route HTTP rejection through the Web request layer and make overview read failures reach the existing panel error handler.
- Keep the API envelope, other stream consumers, and existing account session policy outside this change.

## Decisions

- Use the existing overview eligibility at the component request entry point. This covers both automatic loading and the retry control while leaving outline loading independent.
- Check the HTTP status for the Web overview stream before the shared reader receives the body. Use the existing response error handling for HTTP failures and the existing Web cleanup and login flow for 401. Keep the status check scoped to this endpoint because other stream consumers have their own error protocols.
- Await the reader in the overview panel. Use the shared line decoder for the API's newline-delimited JSON and validate each frame at the component boundary. Show partial text while loading and settle once on a terminal frame or end of stream. Abort failed reads and ignore late failures once the request has settled so an earlier read cannot clear the loading state of an empty-overview retry.

## Risks / Trade-offs

The Web client must distinguish an HTTP-level rejection from errors embedded in a successful response. The former invokes the existing applicable session or request handling. The latter settles the panel without initiating a login redirect. Browser verification will exercise both anonymous and signed-in page flows with local response fixtures.
