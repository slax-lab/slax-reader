# Cloudflare API デプロイ

公開テンプレートは `deploy/cloudflare/api.toml.example` の一つです。ルートから `pnpm api -- config:init` を実行し、無視対象の `api.toml` に実際の値を設定します。dev/build/deploy/types は同ファイルを読み、欠けていれば失敗します。複数の環境では独立した設定を `build/deploy --config <ルート相対パス>` で指定し、リソース名も分離します。

1. 依存関係をインストールし、api.toml と deploy/local/.env（Prisma の二つの URL と Cloudflare 認証情報、自動ロード）を設定して `pnpm api -- gen:all` を実行します。仮 URL はクライアント生成専用です。
2. Wrangler 標準の name、services、[env.*] を使用します。独自の [workers.*] は不要です。Core は環境の name、AI/Browser は AIGC/VECTOR と SlaxBrowser のサービス名を使います。EDGE サービスで公開 Worker 名を指定できます。リモート API は HTTPS を使用し、公開 HTTP は Edge のみです。
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
```

`build` は一時設定と空 env で四つの Worker をオフラインバンドルし、現在の生成設定を上書きしません。`deploy --dry-run` は `.generated/` の生成のみで、クラウドには接続しません。生成ファイルを手で管理しないでください。

新規 bootstrap は Browser → Core（service/Workflow を一時除外）→ AI → Edge（Workflow 作成）→ Core（完全な binding）という順序です。初回中断時は再実行します。既存環境の更新は通常の deploy を使用します。デプロイ・secret・リソース作成・リモートマイグレーションは実操作であり、エージェントによる実行には明示的な許可が必要です。

実行環境は Cloudflare Workers であり、Docker 上の Node API ではありません。ローカルテストやバンドルはクラウド権限・秘密・外部連携を検証しません。デプロイ後に認証・ブックマーク・キュー・決済 callback・同期を確認してください。

設定したフロント origin は events の資格情報付き CORS、画像 Referer、共有リンクの識別にも使われます。スクリーンショットは IMAGE_PREFIX、通知アイコンは FRONT_END_URL を使います。画像 prefix は `/` で終わる独自サービスを指定します。リモートは開発 endpoint を無効にするため `RUN_ENV = "prod"` が必要です。`RUN_TYPE = "prod"` は本番決済、beta/dev はテスト決済です。

## 開発環境の一括起動と外部 CI 設定

開発用リソースと環境ファイルを準備後、`pnpm api -- setup` で Wrangler ログイン、依存サービスの初期化・マイグレーション・生成を実行して終了します。Worker は別途 `pnpm api -- dev` で起動します。`setup --check` はローカル前提条件のみ確認します。Vectorize/AI は引き続きクラウドが必要です。全ツールは SLAX_API_CONFIG（絶対パスまたはリポジトリルート相対パス）に対応し、types は --config も使用できます。手動・再利用可能な .github/workflows/api-deploy.yml は別リポジトリから設定を取得し、検証後にデプロイします。[準備と CI ガイド（中国語）](DEV-AND-CI-CN.md)、[Docker adapter 調査（中国語）](DOCKER-ADAPTER-RESEARCH-CN.md)を参照してください。
