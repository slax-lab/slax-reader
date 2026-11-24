## Context

`validateAppleApplication` gates client verification (`check_inapp_purchase`), App Store Server Notifications and queued Apple event recovery. It derived one expected environment from `RUN_TYPE`: Production for `prod`, Sandbox otherwise. Apple signs TestFlight and App Review purchases as Sandbox transactions even though those builds call the production API.

## Goals / Non-Goals

Goal: verified Sandbox purchases from TestFlight and App Review grant access on production. Non-goals: restricting Sandbox purchases to an allowlist, shortening Sandbox entitlement, excluding Sandbox events from analytics, and changing beta or development admission.

## Decisions

Replace the single expected environment with an allowed set: Production and Sandbox for `prod`, Sandbox for every other installation. Apple recommends that production servers handle Sandbox receipts so App Review purchases succeed.

No new ledger isolation is needed. Grant keys, grant scopes, processed-transaction keys, renewal-state keys and notification job keys already include the transaction environment, and Apple coverage is aggregated per scope.

## Risks / Trade-offs

A TestFlight user receives real Pro access from a free Sandbox purchase. Sandbox subscriptions renew on an accelerated schedule and stop after a limited number of renewals, so access lapses unless the tester buys again. Sandbox grants also produce payment notices and payment telemetry tagged with the Apple gateway; reporting that must exclude them can filter by the `Sandbox` ledger scope. An allowlist or shorter grant was considered and deferred because it adds configuration and an extra branch without an observed need.
