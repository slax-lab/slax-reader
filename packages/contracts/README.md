# packages/contracts

Stable public contracts shared across Slax Reader apps: API schemas, RPC definitions, event and message shapes, and the generated types that come from them.

This package exists so that a contract is defined once and consumed by every side that has to agree on it — web, extension, backend, and CLI — instead of each side restating the same types.

## What belongs here

- API request / response schemas and their generated TypeScript types.
- RPC and WebSocket message definitions.
- Event and queue payload definitions, including cron and consumer message shapes.
- Versioning and compatibility notes for the above.

## What does not belong here

- Runtime behaviour: implementations, handlers, adapters, and clients stay in the app that owns them. A contract package describes shapes; it does not perform I/O.
- Anything only one app uses. An app-local type belongs in that app until a second consumer appears.
- General-purpose helpers — those are separate packages, not part of the contract surface.

## Migration source

New — no existing repository migrates into this directory. The contracts themselves will be lifted out of the applications that currently define them (`slax-lab/slax-reader-api`, `slax-lab/slax-reader-web`) as those migrate in.

## Interim owner

@boxcounter — interim owner until a dedicated code owner is assigned. See `.github/CODEOWNERS`.
