# API 開発

Node.js >= 22.13.0 とルートで固定された pnpm を使用します。コマンドはリポジトリルートから実行します。ルート manifest は汎用 `api` エントリのみを持ち、具体的な scripts・依存関係は `apps/api/package.json` が所有します。実行 cwd は workspace が API に設定します。API 専用の TypeScript・Vitest・ESLint・Prettier・EditorConfig は `apps/api/`、Prisma config は schema と履歴マイグレーションと同じ `apps/api/prisma/` に置きます。Prisma の相対パスは config ファイル基準です。

```bash
pnpm install --frozen-lockfile
pnpm api -- setup:api
pnpm api -- dev
```

```bash
pnpm api -- gen:all
pnpm api -- lint
pnpm api -- typecheck
pnpm api -- test
pnpm api -- build
```

`setup:api` validates operator-provided native Wrangler configuration and keys, runs Wrangler login once, initializes PostgreSQL, runs migrations/codegen, waits for PowerSync health and exits; start Workers separately with `pnpm api -- dev`. No separate database startup command is needed. Missing configuration is reported; setup never writes configuration or keys. Local files live in `deploy/local/`; the public template remains `deploy/cloudflare/api.toml.example`. Existing values are preserved and failures stop startup. `setup:api --check` is read-only; cloud resources and provider credentials still require operator configuration. See [setup details](DEV-AND-CI-CN.md).

Prisma は `deploy/local/.env` から `HYPERDRIVE_DATABASE_URL` と `LOGS_DATABASE_URL` を自動ロードします。手動の export は不要です。仮 URL は生成専用です。`migration:local` は logs を含まず、別コマンドを使います。`gen:pull` は pgsql/logs を明示し、schema を変更し得ます。D1 diff の入力はルート基準で、既存のマイグレーションを上書きしません。履歴 SQL は変更しないでください。

`types` は api.toml の互換日付・flags を使い、隔離ディレクトリと空 env で runtime 型を生成し、手動管理の Env を維持します。wrangler types を直接実行しないでください。新しい binding はテンプレート、`script/deploy/config.ts`、Env を更新します。HTTP controller は `script/gen-routers.ts` に登録します。

任意 smoke はキャッシュ済み `postgres:17-alpine`、統合テストは追加で `redis:7-alpine` を必要とし、`--pull=never` で起動します。HTTP はポート 8787、統合テストは `slax-payment-review` と 6543 を専有し、既存リソースを再利用しません。DB テストは TRUNCATE を行い得るため、使い捨て DB のみ使用します。ログは隔離 `.tmp-root-tooling-http-*` に残ります。`dev:local` の四つのパスは同ワークスペース内に置き、空 env、dev 環境、loopback PostgreSQL、本地 Edge→Core のみを許可します。

クラウド操作には明示的な許可が必要です。[デプロイ](CLOUDFLARE-DEPLOY-JP.md)を参照してください。backfill は読み取り専用・既定で件数のみ・ルート基準の SQL 出力で、自動適用しません。Apple 証明書生成はネットワーク、Stripe は別途 CLI を必要とします。seed はありません。`keys:powersync` は PowerSync 専用の鍵を生成するもので、ブラウザーの Web Push とは関係ありません。

| Task / 操作 | Command |
| --- | --- |
| Discover commands | `pnpm api -- --help` |
| Initialize config (exclusive copy) | `pnpm api -- config:init` |
| Prisma clients | `pnpm api -- gen:model` |
| Runtime Worker types | `pnpm api -- types` |
| DI / router / cron / consumer | `pnpm api -- gen:di` / `gen:router` / `gen:cron` / `gen:consumer` |
| Introspect selected DB | `pnpm api -- gen:pull pgsql` / `logs` |
| D1 diff | `pnpm api -- gen:diff:d1 <root-relative-sqlite-file> <migration-name>` |
| PostgreSQL / logs diff | `pnpm api -- gen:diff:pgsql` / `gen:diff:logs` |
| Local D1 + PostgreSQL + fulltext | `pnpm api -- migration:local` |
| Local logs migrations | `pnpm api -- migration:local:logs` |
| Deploy PostgreSQL / logs migrations | `pnpm api -- migration:deploy:pgsql` / `migration:deploy:logs` |
| Remote D1 / fulltext migrations | `pnpm api -- migration:remote:d1` / `migration:remote:fulltext` |
| Offline bundle | `pnpm api -- build [core\|edge\|ai\|browser]` |
| Config generation only | `pnpm api -- deploy --dry-run` |
| Dev with explicit isolated configs | `pnpm api -- dev:local --edge-config <file> --core-config <file> --state <dir> --env-file <empty-file>` |
| Real HTTP / database integration | `pnpm api -- test:http` / `test:integration:local` |
| Resource plan / create | `pnpm api -- resources` / `resources --apply` |
| Wrangler command with actual config | `pnpm api -- wrangler edge <command> [args...]` |
| Edge logs | `pnpm api -- tail` |
| Complete local API setup | `pnpm api -- setup:api` |
| Maintenance | `pnpm api -- gen:apple-certs` / `backfill:device-alias` |
| Diagnostics | `pnpm api -- debug:hashids` / `debug:hash-article` |
| Optional CLI tools | `pnpm api -- stripe:webhook` / `mcp:tool` / `update:cli` |

## 環境ファイルの配置

- `deploy/local/api.toml`: 秘密を含まない実際のデプロイ設定。公開テンプレートは`deploy/cloudflare/api.toml.example` のみです。
- `deploy/local/.dev.vars`: ローカル Worker の秘密。dev が `--env-file` で明示的に読み込みます。ルートや apps/api に複製しません。本番は Worker secrets を使用します。
- `deploy/local/powersync-local/compose.env`: Docker Compose 用 PowerSync 公開鍵の設定。`pnpm api -- keys:powersync` で生成します。
- `deploy/local/.env`: Prisma の接続 URL と D1/Wrangler・dev・deploy・resources --apply 用の Cloudflare 認証情報（例: `CLOUDFLARE_API_TOKEN`）を自動ロードします。D1 の binding は api.toml を使用します。既存の shell/CI 変数が優先され、setup:api のローカル URL は上書きされません。標準ファイルがなければ CI 変数や Wrangler ログインを使用できます。
- `SLAX_API_ENV_FILE` で別ファイルを絶対パスまたはリポジトリルート相対パスで指定できます。明示したファイルが存在しない・読めない場合は失敗します。ルートの .env は検索しません。build・types・deploy --dry-run・resources の計画表示はツール環境ファイルを読みません。
- `.vars` と `.vars.temp` は利用者が管理する設定入口ではありません。実際の環境ファイルと鍵をコミットしないでください。

## 開発環境の一括起動と外部 CI 設定

開発用リソースと環境ファイルを準備後、`pnpm api -- setup:api` で Wrangler ログイン、依存サービスの初期化・マイグレーション・生成を実行して終了します。Worker は別途 `pnpm api -- dev` で起動します。`setup:api --check` はローカル前提条件のみ確認します。Vectorize/AI は引き続きクラウドが必要です。全ツールは SLAX_API_CONFIG（絶対パスまたはリポジトリルート相対パス）に対応し、types は --config も使用できます。手動・再利用可能な .github/workflows/api-deploy.yml は別リポジトリから設定を取得し、検証後にデプロイします。[準備と CI ガイド（中国語）](DEV-AND-CI-CN.md)、[Docker adapter 調査（中国語）](DOCKER-ADAPTER-RESEARCH-CN.md)を参照してください。
