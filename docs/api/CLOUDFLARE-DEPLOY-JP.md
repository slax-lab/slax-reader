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
pnpm api -- secrets:sync --from ~/slax-secrets/prod.env --dry-run   # 最初の五 Worker リリース前に。下記参照
```

`build` は一時設定と空 env で五つの Worker をオフラインで minify バンドルし、現在の生成設定を上書きせず、Worker ごとに `bundle-<worker>.meta.json` を出力します。`deploy --dry-run` は `.generated/` の生成のみで、クラウドには接続しません。生成ファイルを手で管理しないでください。

新規 bootstrap は Browser → Objects → AI → Edge の順で公開し、AI の前に service/Workflow binding を一時除外した Core を公開して、最後に完全な binding と Workflow を持つ Core を公開することで循環依存を解消します。通常リリースは Browser → Objects → Core → AI → Edge です。新規環境のみで使い、中断時は bootstrap を再実行します。既存環境は通常 deploy を使います。デプロイ・secret・リソース作成・リモート migration は実クラウド操作であり、エージェントが実行する場合は明示的な許可が必要です。

## Worker 構成

| Worker | 配置 | 担当 |
|---|---|---|
| Edge（公開） | 指定なし（利用者の近く） | HTTP 入口：CORS、キャッシュ、画像プロキシ、認証と Core/AI への転送、`ContentEntry`、キュー consumer・cron・Email Routing の受信先（各イベントをそのまま Core の `CoreJobs` に転送） |
| Core | `aws:ap-southeast-1` | `AI_ROUTES` 以外の Reader ルート、`CoreJobs` 経由のキュー・cron・newsletter メール処理、六つの Workflow、`VectorPreferenceObject` |
| AI | `aws:ap-southeast-1` | `apps/api/src/const/routes.ts` の `AI_ROUTES`（AIGC、概要/アウトライン、検索、推薦、ベクトル更新）と `AiEntry` ベクトル RPC |
| Objects | `aws:ap-southeast-1` | `SlaxJieba`、`SlaxWebSocketServer`、`ScreenshotBrowser` の Durable Object（HTTP なし） |
| Browser | 指定なし | `SlaxBrowser`（変更なし） |

placement は `apps/api/script/deploy/config.ts` の `DATABASE_REGION`（主 PostgreSQL に最も近いリージョン）が決めます。非公開設定の `[placement]` はリモート操作前に拒否されます。Core と Edge は既存の `SlaxJieba`・`SlaxWebSocketServer`・`ScreenshotBrowser` namespace を 410 を返すスタブクラス（`apps/api/src/entry/retired.ts`）で保持し、そのデータは削除しません。廃止した MCP Server の `SlaxMcpServer` namespace は保存済みセッションごと削除します。アカウントにこの namespace が残っている間、リリースは Edge と Core に `retire-mcp-v1`（`deleted_classes = ["SlaxMcpServer"]`）を加えます（下記参照）。非公開の migration 履歴を変更する必要はありません。Objects は独自の migration tag `objects-v1` を持ちます。

## 最初の五 Worker リリース（既存環境）

Edge は既存のキュー consumer・cron・Email Routing の受信先をそのまま持ち、各イベントを service binding（`CORE_JOBS`、entrypoint `CoreJobs`。service binding の呼び出しは追加リクエストとして課金されません）で Core に転送します。トリガー・consumer・メールルールは一切移動しないため、最初の五 Worker リリースも通常の `deploy`（CI または `pnpm api -- deploy`）です。リモートリリースは最初の公開前にアカウントを読み、次を行います。

- コードが読む値をいずれかの Worker が持たない場合（下記）、Worker 名と key 名を示して停止します。
- 公開順序を決めます。`SlaxMcpServer` namespace が残っている間は Browser → Objects → Core（旧 Edge が Core の namespace を束縛しているため MCP スタブを export したまま）→ AI → Edge（Edge の namespace を削除）→ Core（Core の namespace を削除）の順に公開します。Workflow は Core の最初の公開で Wrangler が Core に移します。以降のリリースは namespace が無いため Browser → Objects → Core → AI → Edge です。

値はコードと一緒に移す必要があります。デプロイは `--keep-vars` を使うため、`wrangler secret put` で設定した secret は元のスクリプトにのみ残ります。`apps/api/script/deploy/runtimeKeys.ts` は各 Worker のコードが読む文字列変数と secret を列挙します（テストがバンドルから再導出します）。リリースは、ある Worker が読み、同じ環境の別の API Worker が持つが、その Worker 自身と選択した `[vars]` のどちらにも無い key を名前で列挙して停止します。Cloudflare は secret の値を返さないため旧 Edge からコピーできません。値を保存したファイル（パスワードマネージャーのエクスポートや元の `.env`、リポジトリ外か無視対象の `deploy/local/`）を用意して実行します。ファイルは `.env`、JSON（`{"KEY": "value"}` または `[{"name": "KEY", "value": "value"}]`、`key` も可）、またはトップレベルの `KEY = "value"` 行からなる `.toml` で、数値と真偽値は文字列としてアップロードされ、その他の `{` か `[` で始まる内容は JSON として読みます。読めない場合は位置・key 名・値の型のみを報告し、値は出力しません。以下を実行します。

```bash
pnpm api -- secrets:sync --from ~/slax-secrets/prod.env --dry-run   # Worker 名とキー名のみ表示
pnpm api -- secrets:sync --from ~/slax-secrets/prod.env             # wrangler secret bulk でアップロード
```

各 Worker には、コードが読み、別の API Worker が持ち、自身に無い key だけをアップロードし、既存の secret は上書きしません。値は stdin で Wrangler に渡し、コマンドライン・ファイル・ログには出しません。未デプロイの Worker はスキップし、必要な key がファイルに無ければ失敗します。最初のリリース前に Core と AI 向けに一度実行します。Objects は新しい Worker で、必要な値は `[vars]` から受け取るか、リリースが作成した後にもう一度実行します。値を非公開設定の `[vars]` に置くこともできます。2026-11-23 の読み取り専用チェックでは、本番と beta の Core と AI に `DEEPSEEK_API_KEY` がありませんでした。test アカウントは揃っています。どの Worker にも無い key は現在未設定の任意機能で、報告されません。

最初のリリース中、数回の公開にかかる時間だけ、次のことが起こり得ます。AI の Workflow binding が新しい Core を待つ間 AI ルートが失敗する、Core と AI の公開の間は旧 AI が Core の廃止済み jieba namespace を使うため検索の分かち書きが失敗する、旧 Edge 上で Core の廃止済み Durable Object を呼ぶジョブが失敗しキューが再試行する。低負荷の時間帯に、test アカウント、beta、本番の順に実行してください。

ロールバック：MCP namespace を削除する前（このリリースの最後の二回の公開より前）は、`wrangler rollback` で各 Worker を前のバージョンに戻します。削除後は Wrangler が Edge と Core を削除前に戻すことを拒否します。その他の変更は `SlaxMcpServer` を export しないバージョンをデプロイして戻せます。

実行環境は Cloudflare Workers であり、Docker 上の Node API ではありません。ローカルテストやバンドルはクラウド権限・秘密・外部連携を検証しません。デプロイ後に認証・ブックマーク・キュー・決済 callback・同期を確認してください。

設定したフロント origin は events の資格情報付き CORS、画像 Referer、共有リンクの識別にも使われます。スクリーンショットは IMAGE_PREFIX、通知アイコンは FRONT_END_URL を使います。画像 prefix は `/` で終わる独自サービスを指定します。リモートは開発 endpoint を無効にするため `RUN_ENV = "prod"` が必要です。`RUN_TYPE = "prod"` は本番決済、beta/dev はテスト決済です。

## 開発環境の一括起動と外部 CI 設定

開発用リソースと環境ファイルを準備後、`pnpm api -- setup` で Wrangler ログイン、依存サービスの初期化・マイグレーション・生成を実行して終了します。Worker は別途 `pnpm api -- dev` で起動します。`setup --check` はローカル前提条件のみ確認します。Vectorize/AI は引き続きクラウドが必要です。全ツールは SLAX_API_CONFIG（絶対パスまたはリポジトリルート相対パス）に対応し、types は --config も使用できます。手動・再利用可能な .github/workflows/api-deploy.yml は別リポジトリから設定を取得し、検証後にデプロイします。[準備と CI ガイド（中国語）](DEV-AND-CI-CN.md)、[Docker adapter 調査（中国語）](DOCKER-ADAPTER-RESEARCH-CN.md)を参照してください。
