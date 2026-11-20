# Cloudflare API デプロイ

公開テンプレートは `deploy/cloudflare/api.toml.example` の一つです。ルートから `pnpm api -- config:init` を実行し、無視対象の `api.toml` に実際の値を設定します。dev/build/deploy/types は同ファイルを読み、欠けていれば失敗します。複数の環境では独立した設定を `build/deploy --config <ルート相対パス>` で指定し、リソース名も分離します。

1. 依存関係をインストールし、api.toml と deploy/local/.env（Prisma の二つの URL と Cloudflare 認証情報、自動ロード）を設定して `pnpm api -- gen:all` を実行します。仮 URL はクライアント生成専用です。
2. Wrangler 標準の name、services、[env.*] を使用します。独自の [workers.*] は不要です。Core は環境の name、AI/Browser は AIGC/VECTOR と SlaxBrowser のサービス名を使います。EDGE サービスで公開 Worker 名、OBJECTS サービスで Objects Worker 名を指定できます（既定は Core 名の `reader-core` を `reader-objects` に置き換えた名前）。リモート API は HTTPS を使用し、公開 HTTP は Edge のみです。
3. D1・KV・R2・キュー・五つの 1024 次元 cosine Vectorize・PostgreSQL/Hyperdrive・PowerSync を用意します。resources は計画のみ、--apply は自分の account/token で不足リソースを作り ID を表示します。Hyperdrive・DB・外部サービスは作成しません。外部 `fxembed`（SlaxTwitterFxembed）は別途用意します。Browser Rendering を含む各製品の権限が必要です。
4. 論理 binding 名を維持し、物理名を設定します。キューは producer binding と IMPORT_OTHER の dead_letter_queue で関連付けます。元の設定ファイルは変更しません。環境ごとにキューと Workflow 名を分離してください。
5. 既存環境では Worker 名・リソース ID・DO migration tags/classes・履歴を維持します。テンプレートで本番履歴を置換しないでください。リモート D1/fulltext と PostgreSQL/logs のマイグレーションは、開発ガイドのコマンドで対象を確認して別途実行します。
6. 秘密は Worker secrets、本地では無視対象の `.dev.vars` を使います。Edge/Core/AI の EDGE_SHARED_SECRET は同一にします。JWT・Hashids・決済・OAuth・モデル・PowerSync の設定は Env 契約を参照してください。TOML に秘密を書かず、提供者の callback URL も独自 origin に設定します。

```bash
pnpm api -- build
pnpm api -- deploy --dry-run
pnpm api -- resources                 # plan only
pnpm api -- resources --apply         # creates remote resources
pnpm api -- deploy --bootstrap        # NEW installation only
pnpm api -- deploy                    # subsequent updates
pnpm api -- deploy edge               # update one existing Worker
pnpm api -- wrangler edge secret put EDGE_SHARED_SECRET
pnpm api -- topology:transition --step 1 --dry-run   # 既存環境で一度だけ。下記参照
```

`build` は一時設定と空 env で五つの Worker をオフラインで minify バンドルし、現在の生成設定を上書きせず、Worker ごとに `bundle-<worker>.meta.json` を出力します。`deploy --dry-run` は `.generated/` の生成のみで、クラウドには接続しません。生成ファイルを手で管理しないでください。

新規 bootstrap は Browser → Objects → Core（service/Workflow を一時除外）→ AI → Edge → Core（完全な binding、Workflow・キュー consumer・cron を作成）という順序です。通常のリリースは Browser → Objects → AI → Core → Edge の順です。初回中断時は再実行します。既存環境の更新は通常の deploy を使用します。デプロイ・secret・リソース作成・リモートマイグレーションは実操作であり、エージェントによる実行には明示的な許可が必要です。

## Worker 構成

| Worker | 配置 | 担当 |
|---|---|---|
| Edge（公開） | 指定なし（利用者の近く） | HTTP 入口：CORS、キャッシュ、画像プロキシ、認証、Core/AI への転送、`ContentEntry` |
| Core | `aws:ap-southeast-1` | `AI_ROUTES` 以外の Reader ルート、キュー consumer、cron、newsletter メール、六つの Workflow、`VectorPreferenceObject` |
| AI | `aws:ap-southeast-1` | `apps/api/src/const/routes.ts` の `AI_ROUTES`（AIGC、概要/アウトライン、検索、推薦、ベクトル更新）と `AiEntry` ベクトル RPC |
| Objects | `aws:ap-southeast-1` | `SlaxJieba`、`SlaxWebSocketServer`、`ScreenshotBrowser` の Durable Object（HTTP なし） |
| Browser | 指定なし | `SlaxBrowser`（変更なし） |

placement は `apps/api/script/deploy/config.ts` の `DATABASE_REGION`（主 PostgreSQL に最も近いリージョン）が決めます。非公開設定の `[placement]` はリモート操作前に拒否されます。Core と Edge は既存の `SlaxJieba`・`SlaxWebSocketServer`・`ScreenshotBrowser` namespace を 410 を返すスタブクラス（`apps/api/src/entry/retired.ts`）で保持し、そのデータは削除しません。廃止した MCP Server の `SlaxMcpServer` namespace は保存済みセッションごと削除します。非公開の migration 履歴がこのクラスを作成している場合、Core の生成設定は `retire-mcp-v1`（`deleted_classes = ["SlaxMcpServer"]`）を追加し、移行ステップ 4 が Edge と Core に適用します。Objects は独自の migration tag `objects-v1` を持ちます。

## 五 Worker への移行（既存環境）

通常の `deploy` はアカウント状態（Worker、Workflow、キュー、cron、Durable Object namespace）を読み、Objects/AI/Core が未デプロイ、Workflow かキュー consumer が Edge に残っている、Edge に cron がある、または `SlaxMcpServer` namespace が残っている場合は公開前に停止します。移行は環境ごとに一度、test アカウント、beta、本番（低負荷時間帯）の順に実行します。`CLOUDFLARE_API_TOKEN`（Workers Scripts・Queues・Workflows・Durable Objects の編集権限）または `wrangler login` のトークンを使い、`--config`/`--env` は `deploy` と同じです。各ステップは状態を先に読み、再実行でき、`--dry-run` に対応します。ステップ 1〜3 は何も削除せず、Core と Edge はステップ 4 まで MCP スタブ（`src/entry/transition/`）を export し続けます。

値はコードと一緒に移す必要があります。デプロイは `--keep-vars` を使うため、`wrangler secret put` で設定した secret は元のスクリプトにのみ残ります。`apps/api/script/deploy/runtimeKeys.ts` は各 Worker のコードが読む文字列変数と secret を列挙します（テストがバンドルから再導出します）。ステップ 1〜3 の公開前と通常リリースの前に、ある Worker が読み、同じ環境の別の API Worker が持つが、その Worker 自身にも選択した `[vars]` にもないキーを名前のみで列挙して停止します。非公開設定の `[vars]` に追加するか、その Worker に `pnpm api -- wrangler <worker> secret put <NAME>` を実行してください。2026-11-20 の読み取り専用チェックでは、本番と beta の `DEEPSEEK_API_KEY` が旧 Edge にのみあり（Core に移る YouTube 記事・ポッドキャスト Workflow と AI が読む）、test アカウントでは Core の 17 個・AI の 5 個のキーが旧 Edge にのみありました。どの Worker にもないキーは未設定の任意機能として報告しません。

1. `--step 1` は Browser と Objects を公開します。Objects の三つの namespace を確認します。
2. `--step 2` は AI を公開し、各キューの Edge consumer と Edge の cron を外してから、Workflow・consumer・cron・Objects への DO binding を持つ Core を公開します。その間メッセージはデプロイ一回分キューで待機します。全 Workflow とキュー consumer が Core に属さなければ失敗し、Workflow の所属を前後で表示します。実行中のインスタンスが進行することを確認します。
3. `--step 3` は軽量化した Edge を公開します。その後ダッシュボードで newsletter の Email Routing ルールを Edge から Core に向けます。
4. 軽量化した Edge でルート、`ContentEntry`、画像プロキシ、AI ルート、WebSocket upgrade、キューの往復、Workflow 作成を確認します。その後 `--step 4` は全所属チェックの合格を求め、`retire-mcp-v1` を持つ Edge、Core の順に公開し、`SlaxMcpServer` namespace が残っていないことを確認します。このステップは不可逆で、保存済み MCP セッションを完全に削除します。Edge を先にするのは、他の Worker が Core の namespace を binding している間は Cloudflare が削除を拒否するためです。非公開設定の Core 履歴に `SlaxMcpServer` が記録されていない場合は、ステップ 4 の前に Cloudflare が報告する tag で追加してください（例：`{ tag = "v2", new_sqlite_classes = ["SlaxMcpServer"] }`）。Wrangler は削除のみを追加します。

ロールバック：ステップ 2 より前は `wrangler rollback` で旧版に戻します。ステップ 2 以降ステップ 4 より前は、Edge にキュー consumer と cron を戻し、旧 Edge（Workflow を宣言）、旧 Core の順に再デプロイし、Email Routing を Edge に戻します。namespace は削除されていないためデータは失われません。ステップ 4 以降は MCP namespace が削除済みで、Wrangler はそのデプロイより前へのロールバックを拒否します。他の構成変更は上記の方法で戻せますが、`SlaxMcpServer` を export しない版を使います。

実行環境は Cloudflare Workers であり、Docker 上の Node API ではありません。ローカルテストやバンドルはクラウド権限・秘密・外部連携を検証しません。デプロイ後に認証・ブックマーク・キュー・決済 callback・同期を確認してください。

設定したフロント origin は events の資格情報付き CORS、画像 Referer、共有リンクの識別にも使われます。スクリーンショットは IMAGE_PREFIX、通知アイコンは FRONT_END_URL を使います。画像 prefix は `/` で終わる独自サービスを指定します。リモートは開発 endpoint を無効にするため `RUN_ENV = "prod"` が必要です。`RUN_TYPE = "prod"` は本番決済、beta/dev はテスト決済です。

## 開発環境の一括起動と外部 CI 設定

開発用リソースと環境ファイルを準備後、`pnpm api -- setup` で Wrangler ログイン、依存サービスの初期化・マイグレーション・生成を実行して終了します。Worker は別途 `pnpm api -- dev` で起動します。`setup --check` はローカル前提条件のみ確認します。Vectorize/AI は引き続きクラウドが必要です。全ツールは SLAX_API_CONFIG（絶対パスまたはリポジトリルート相対パス）に対応し、types は --config も使用できます。手動・再利用可能な .github/workflows/api-deploy.yml は別リポジトリから設定を取得し、検証後にデプロイします。[準備と CI ガイド（中国語）](DEV-AND-CI-CN.md)、[Docker adapter 調査（中国語）](DOCKER-ADAPTER-RESEARCH-CN.md)を参照してください。
