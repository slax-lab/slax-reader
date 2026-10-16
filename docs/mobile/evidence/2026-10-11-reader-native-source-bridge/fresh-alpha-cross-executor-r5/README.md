# Fresh Alpha/Cross revision 5 — prepared only

OpenSpec: `expo-mobile-migration`.

The actual revision-4 attempt booted and launched the independent UI app, then failed the controller's strict Inspector match before either native selector ran. Its raw 40-file negative receipt remains immutable. The attempt did not retain the Inspector inventory and does not prove why a matching Inspector was absent.

Revision 5 uses the exact independent development URL already declared by `apps/mobile/tooling/fixture-project.mjs` and the scheme present in the actual 148-file installed app's public `Info.plist`. It replaces the generic app launch with one exact `simctl openurl` for B85 and `slaxreader-ui-fixture://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8083`. The main app, other schemes, ports, devices and Metro restarts are refused.

The new owned readiness helper performs only a bounded metadata GET to `http://127.0.0.1:8083/json/list`. It retries zero matching independent targets for at most 20 seconds, at most 80 requests and 2 seconds per request. Each response is limited to 64 KiB and 200 inventory entries. A matching target is selected by the unchanged production `selectFixtureInspector` using the exact app ID and device name; duplicate matches, unsafe endpoints, invalid responses and transport failures stop the attempt. Unmatched inventory contents are not persisted. Readiness opens no WebSocket, evaluates no expression and prepares no fixture state.

The outer readiness command has a 22-second stop limit. Scene preparation has a 25-second outer limit instead of the previous generic 5 seconds, allowing the unchanged controller's bounded connection/evaluation waits to occur. These are per-command caps inside the same shared 180-second window, with the original 30-second release reserve, 4-second kill grace and 45-second native test caps. They are not added time. A late cold start can still exhaust the available Alpha/Cross handoff time; that outcome must fail and release without Cross input. There is no retry, timeout bypass or alternate Inspector selection.

A new exact run/grant pair is synchronized in the executor, policy, snapshot helper and readiness CLI:

- `/private/tmp/slax-reader-fresh-alpha-cross-38ce646b95414adf8aabe2776c313ca4`
- `/private/tmp/slax-reader-fresh-alpha-cross-grants-38ce646b95414adf8aabe2776c313ca4`

Actual Node guards admit the new snapshot root only as far as its expected absent report and reject all three historical roots before file reads. The raw child argv, exit and split logs are preserved. Seven injected-transport Node checks exercise the actual production selector, cold metadata attachment, bounded response/request/deadline, cancellation and retained negative scope. Five focused Python checks exercise exact deep-link/owner restrictions, actual public scheme provenance, current orchestration command budgets and synchronized Node root admission. The two root checks were separately invoked with the author-only evidence flag solely to retain their four raw child results; these are not counted as additional distinct checks.

The original 377-file stage, installed 148-file app, compiled 63/53 helpers, 256 MiB logical-and-allocated accounting (including new bootstrap/current scopes), 8 MiB logs and 3 GiB free floor are unchanged. All old scopes, products, native code, production controller/selector and actual earlier reports remain protected. No broad unchanged guards were repeated.

No native command, compiler, live process query, device action, HTTP request, Metro change, database read, stage mutation, cleanup or account operation occurred in this preparation. Actual current admission and a fresh exclusive Root grant are required. Readiness metadata and host passes cannot certify native Alpha, Cross, visual parity or publisher delivery.
