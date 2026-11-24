# Accept Sandbox Apple purchases on the production API

## Why

TestFlight builds use the production API, but every TestFlight in-app purchase is an App Store Sandbox transaction. The production API accepts only Production transactions, so purchase verification rejects a successful TestFlight purchase with "Invalid parameter", leaves the transaction unfinished and blocks internal purchase testing. App Review also purchases in the Sandbox against the production server, so the same rejection affects review.

## What Changes

- The production installation accepts verified Apple transactions and server notifications from both the Production and Sandbox environments.
- Development and beta installations continue to accept only Sandbox transactions.
- Every other check is unchanged: Apple signature chain, bundle identifier, product allowlist, transaction type, account token, order and active-period checks.
- Sandbox grants keep their existing environment-qualified ledger keys and scopes, so they never deduplicate or extend coverage against Production transactions.

## Capabilities

### New Capabilities

- `apple-iap-validation`: Environment admission for verified Apple in-app purchase transactions and notifications.

### Modified Capabilities

None.

## Impact

Only the environment check in `SubscriptionAppleService` changes. Accounts that hold a TestFlight build can obtain Pro access through a Sandbox purchase on production for as long as the Sandbox subscription renews. The operator accepted this for internal testing and App Review. Client, contract, schema and configuration are unchanged.
