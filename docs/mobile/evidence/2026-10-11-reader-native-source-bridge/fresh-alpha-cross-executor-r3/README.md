# Fresh Alpha/Cross executor revision 3 — prepared only

OpenSpec: `expo-mobile-migration`.

The actual revision-2 attempt stopped after two completed commands, before any boot, product copy, fixture preparation, database query, or native input. Its archived Metro command is a deliberate relative Node CLI invocation. Requiring the absolute fixture stage to occur inside that command was an invalid guard. The original attempt, grant, receipt, and Root/UI negative reviews remain unchanged.

Revision 3 admits only the observed exact command bytes and an independently queried exact working directory for the same owned PID 93891. It adds the closed command `/usr/sbin/lsof -a -p 93891 -d cwd -Fn`, whose executable bytes are pinned in the policy. Its output must be exactly the three newline-terminated `p93891`, `fcwd`, and `n<canonical stage>` fields. Unknown PIDs/directories, missing or duplicate fields, extra output, altered CLI options, arbitrary substring matches, and old revision-2 grant paths are rejected. The executor rechecks the unchanged 377-file stage before copying products. It does not restart or reconfigure Metro.

The Root-provided working-directory bytes were collected after the failed attempt. They are separate diagnostic evidence, not a claim that the original two-command attempt checked the directory. A future allocated run must collect fresh exact PID/argv/cwd evidence itself; the archived diagnostic cannot authorize native input.

The new run and grant names are unique revision-3 paths:

- `/private/tmp/slax-reader-fresh-alpha-cross-70641adca8a446cbbeb6177a7e5dfe2c`
- `/private/tmp/slax-reader-fresh-alpha-cross-grants-70641adca8a446cbbeb6177a7e5dfe2c`

Neither path has been created by this preparation. A fresh Root allocation, current admission, and independent review are required before execution. Revision 2 is retained as historical evidence and is not retried.

The shared 180-second input budget, distinct Root continuation grant, 45-second per-selector limit, 30-second release reserve, 256 MiB total logical/allocated cap including the two strictly marker-proved new UI scopes, 3 GiB ongoing free-space floor, 3.6 GiB preflight, installed 148-file UI, 63/53 compiled helper products, and 377-file stage closure are unchanged. No native source, products, fixture data, cache, Metro, device, or ordinary runtime is modified.

## Focused host verification

Only the six added Metro/new-root guards were executed for this revision. They consume the immutable Root-provided raw command/directory files, not live processes. All six passed with no skips. The previous revision's 33 passing host guards remain separately bound as historical checks; they were not rerun or relabeled as revision-3 native admission.

```text
python3 -B inputs/runtime-guards.test.py \
  Guards.test_actual_root_relative_cli_and_three_cwd_fields_are_accepted \
  Guards.test_relative_cli_requires_exact_live_owned_cwd \
  Guards.test_cwd_missing_duplicate_extra_fields_and_raw_whitespace_are_refused \
  Guards.test_cli_options_headers_paths_and_whitespace_cannot_replace_exact_argv \
  Guards.test_lsof_command_is_closed_to_exact_owned_pid_and_cwd_only \
  Guards.test_prior_run_commands_and_allocation_paths_are_refused_before_read
```

No live admission, native command, compiler, process query, Metro request, boot, database read, or device action was performed by this preparation. Actual fresh Alpha input, its Root-reviewed raw/frame/live barrier, Cross input, and complete product acceptance remain pending.
