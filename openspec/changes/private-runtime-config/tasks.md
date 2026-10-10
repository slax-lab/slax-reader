# Tasks

- [x] 1. Restore recoverable legacy runtime values to all three private TOMLs and annotate unavailable fields without publishing placeholders; update the private operator guide.
- [x] 2. Accept private runtime `[vars]` in the release loader and API validator, retain outside-table declarative restrictions, protect generated files and preserve omitted remote bindings during deployment.
- [x] 3. Update deployment documentation and existing configuration regressions for the approved private runtime source.
- [x] 4. Verify synthetic configuration round trips, loader acceptance/rejection/privacy, remote command arguments and existing runtime type safety; run strict OpenSpec validation and the Bugs/Security/Compliance review.

Verification: 21 existing configuration/type-safety regressions passed; 11 isolated loader cases and YAML/inline syntax passed; mocked remote/local deployment arguments and Worker order passed; lint and strict OpenSpec validation passed. The three edited private configurations passed owner-only generation and resource-preservation checks without remote operations. Bugs/Security/Compliance review found no Important issues; the matched change-id is `private-runtime-config`.

Operator inputs remain pending where original provider values are unavailable. These are commented in the private TOMLs and are not claimed to be recovered or deployed. No live deployment was performed during implementation verification.
