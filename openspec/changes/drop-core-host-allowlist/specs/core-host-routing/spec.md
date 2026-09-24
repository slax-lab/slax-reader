# Spec Delta

## Purpose

Describe how the Core worker's HTTP entry treats the request Host, so that dropping runtime Host validation is an explicit, reviewable requirement instead of a side effect of an unrelated refactor.

## ADDED Requirements

### Requirement: Core routes requests without runtime Host validation

The Core worker SHALL route any request that reaches it through the registered middleware and controller routes without validating the request Host against `BACKEND_API_PREFIX` or any fixed host list, and SHALL NOT reject a request solely because its Host is not a configured or previously recognized host.

#### Scenario: Request arrives under an unconfigured Host

- **WHEN** a request reaches the Core worker with a Host that is neither the configured `BACKEND_API_PREFIX` origin nor a legacy deployment host
- **THEN** the worker applies the registered middleware and routes the request to the matching controller instead of failing with a `host not found` response

#### Scenario: Configured origin is no longer required for routing

- **WHEN** `BACKEND_API_PREFIX` is absent, malformed, or carries credentials
- **THEN** the worker still routes the request, because the runtime no longer derives its routing decision from that value

### Requirement: Deploy tooling still requires the public origin

The API deployment tooling SHALL continue to require `BACKEND_API_PREFIX` as an HTTP(S) origin without credentials or a path, and SHALL continue to require a real HTTPS origin for remote deployment, independently of the runtime routing decision.

#### Scenario: Operator configuration is incomplete

- **WHEN** a build, deploy, or resource command runs without a valid `BACKEND_API_PREFIX`
- **THEN** the command fails before any cloud mutation, even though the Worker runtime no longer reads that value for routing
