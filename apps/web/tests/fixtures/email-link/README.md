# Email link Web acceptance fixture

Run from the repository root with `redis-server` and `redis-cli` on PATH:

```sh
pnpm --filter slax-reader-backend exec tsx --tsconfig tsconfig.json ../web/tests/fixtures/email-link/serve.mjs 4296
```

Open `http://localhost:4296`. The three entries exercise new login, current-session preservation, and a consumed proof. The fixture mounts the actual page, composable, HTTP client, cookie completion, and email-code service against disposable Redis. Resend is captured locally; account/session responses are synthetic and never authorize real account data. No operator secret is loaded or real email sent. The independent API HTTP smoke exercises actual Core DI, PostgreSQL ownership and session completion.

The canonical entry and browser-only alias both run the production critical-head proof capture. A following DOM meta trap records the fragment visible to later scripts; it must be empty. `?theme=light`, `?theme=dark`, or `?theme=eink` on either entry selects the fixture's display theme before proof capture cleans the URL. Stop with Ctrl-C to dispose the fixture Redis process.
