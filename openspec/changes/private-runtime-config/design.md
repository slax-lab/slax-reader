# Design

The operator approved restoring runtime configuration, including credentials, to the private environment TOMLs. `[vars]` remains native Wrangler data, without a second configuration format or a separate upload command. Release accepts only string values in that top-level table. All other configuration retains the existing restrictions against credential material and executable hooks.

Normal remote deployment uses `--keep-vars` so unavailable original values do not erase existing remote bindings while recovery is incomplete. Wrangler replaces a same-name remote Secret with an explicitly configured TOML variable. Omitted values remain remote until the operator supplies them in the private TOML; removing a TOML entry alone does not delete an existing remote binding. Local deployment is unchanged.

Generated TOMLs are owner-readable/writable only. Public release logs still capture private output in restricted temporary storage and clean it up. Runtime values never enter public examples, specifications, fixtures or generated Env literal types. Deployment authentication, database migration URLs, Tunnel and private-repository access remain Actions Secrets.

Recover only values present in the legacy tracked TOMLs or known historical source configuration. Do not read credential files or attempt to recover Cloudflare Secret values. Mark unavailable inputs as commented entries in the private TOML, rather than publishing placeholders or creating new salts, keys or webhook credentials. Provider-dependent values, including distinct Apple web/native audiences and Stripe livemode, require operator confirmation when history does not establish them.
