# rr — Requirements Review

要件定義などの **HTML成果物そのものを見ながらレビューコメントを付け、そのコメントをQueueに積み、Claude Codeに順番に反映させる** ローカルアプリです。チャットUIではなく、常にHTML成果物が中心にあります。

```
HTML成果物 → 人間のレビューコメント → Queue → Claude Codeによる修正 → HTML更新 → 再レビュー
```

> アプリ本体は [`tools/rr/`](tools/rr/) にあります。以降のコマンドは `tools/rr/` を起点に実行します。

## 特徴

- 要件定義HTMLをブラウザ上の iframe に表示し、見た目を維持したままレビュー
- `data-rr-id` を持つ要素をホバーして、**インラインで**行単位・ブロック・表行・表セルにコメント
- 成果物全体への「全体指摘」
- **UIから新しい要件を生成**: タイトル＋テーマを入力 → Claude Code が初版HTMLを作成 → そのままレビュー開始
- **複数要件の保存・ロード**: 要件ごとに `docs/requirements/<slug>.html` を作成し、上部のセレクタで切替。コメント・Queueは要件ごとに独立
- **既存HTMLの自動取り込み**: `docs/requirements/*.html` を手動で置いても、起動時・一覧取得時・ファイル変更時に自動でスキャンして一覧に追加（編集すれば再読み込み・「更新あり」通知）
- **要件の削除**: 上部「管理」から個別削除、または「🗑 未生成を削除」でHTML未生成の要件を一括削除。既定のサンプル（`index`）も他に要件があれば削除可能（最後の1件だけは残ります）。生成失敗で残った空の要件は自動でクリーンアップ
- コメントは **追加した順に自動で処理**（既定で Queue は running。同一HTMLへは直列）。明示的に Pause も可能
- 生成・反映の進捗を**逐次表示**（Claudeのテキスト・ファイル編集/読み込み等を `--output-format stream-json` から整形）
- **セッション継続（resume）が既定**: 初版生成のセッションも保存し、最初の修正から要件ごとに直前の Claude セッションを `--resume`。要件理解が深まった状態で次の指摘を反映します。新規セッションになるのは「もう一度実行（最初から）」を**明示した場合**か `resume_session: false` のときだけ。指定セッションが無効なら自動で新規にフォールバック。結果パネルに `🔁 resume`/`🆕 new` と**トークン使用量・コンテキスト消費率・1回の最大出力（max output tokens）**を表示
- **resume以外でも文脈を呼び起こす**: セッションを再開しない場合は、過去の対応内容を要約した**「これまでの検討」ダイジェスト**をプロンプトに自動注入
- **修正は全体整合を見て行う**: 指摘箇所だけを局所的に直すのではなく、まず文書全体を読み込み、関連する記述・表・前提・用語統一・確定/推測/未確認の区分まで見渡して整合性を保って修正します（無関係な箇所は変更しない）
- **途中終了の検知と再実行**: 出力打ち切り（max_tokens）・partially_applied・needs_human_review・needsFollowUp 等を検知し、結果パネルで「**続きを実行**（前回セッションを `--resume` で継続）」と「**もう一度実行**（最初から）」を選べます。途中終了したコメントは applied にせず未完了のまま保持します
- Claude Code が修正、実行前に必ずバックアップを作成
- **HTMLのダウンロード**: 上部「⬇ ダウンロード」で表示中の要件HTMLをファイルとして保存（日本語タイトルのファイル名にも対応）
- 「更新あり」「Claudeコメント」「diff」を UI に表示
- SSE による即時更新通知

## インストール / ビルド

```bash
cd tools/rr
npm install
npm run build      # クライアント(vite) + サーバー(tsc) をビルド
```

開発時:

```bash
npm run dev:server   # Fastify (tsx watch)
npm run dev:client   # Vite dev server (port 5178, /api を 5177 にプロキシ)
```

### `rr` コマンドを使えるようにする

ビルド後、`dist/cli/index.js` への symlink を PATH の通った場所に置きます:

```bash
ln -sf "$(pwd)/dist/cli/index.js" ~/.local/bin/rr   # ~/.local/bin が PATH にある場合
# もしくは: npm link （グローバルへの書き込み権限が必要）
```

## 使い方

対象リポジトリのルートで、**`rr` だけで起動**できます:

```bash
cd /path/to/target-repository
rr
```

これだけで:

1. 未初期化なら自動で `init`（`.rr/` と `docs/requirements/index.html` を作成）
2. レビューUIサーバーを起動（http://127.0.0.1:5177/app/）
3. 既定ブラウザでUIを開く

ブラウザを開いたら、上部の **「＋ 新しい要件」** にタイトルと扱いたいテーマを入力し
「生成してレビュー開始」を押すと、Claude Code が初版HTMLを生成し、そのまま左ペインに
表示されてレビューに入れます。要件が複数になったら上部のセレクタで切替（ロード）できます。

ブラウザを開きたくない場合は `rr --no-open`、自動initを無効にしたい場合は `rr --no-init`。

ポートは既定で設定値（5177）を使い、**使用中なら自動で空きポートに切り替えます**。
明示指定したい場合は `rr --port 6001`。実際に開いたURLは起動ログに表示されます。
停止は **Ctrl+C**（ブラウザを開いたままでも確実に終了します）。

CLIからの生成も可能:

```bash
# 新しい要件ドキュメントを作成して生成
rr generate --title "券種をまたぐ購入制約" --prompt "この既存システムについて、券種をまたぐ購入制約の実装方式を検討してください"
rr generate --prompt-file .rr/prompts/initial.md
# 現在の要件を作り直す（新規作成しない）
rr generate --current --prompt "..."
```

複数要件は `docs/requirements/<slug>.html` として保存されます。
個別コマンド（`rr init` / `rr serve` も従来どおり利用可能）。

その後はブラウザで:

1. 要件定義HTMLを見る
2. 右ペイン上部の「全体指摘」を書く
3. HTML要素をホバーして 💬 コメント（行/ブロック/表行/表セル）
4. `Save and Queue` または一覧から Queue に追加
5. `Run next` / `Run all` で処理
6. Claude Code がHTMLを修正
7. 「更新あり」「Claudeコメント」「diff」を確認

## CLI コマンド

| コマンド | 説明 |
| --- | --- |
| `rr` (引数なし) | 既定で `serve`。未初期化なら自動init→起動→ブラウザを開く |
| `rr init` | `.rr/`(config.yml, prompts, rr.db) と初期HTMLを作成 |
| `rr serve [--no-init] [--no-open]` | レビューUIを起動 |
| `rr generate [--prompt <text>] [--prompt-file <path>]` | Claude Code で初版生成 |
| `rr inject-ids` | 既存HTMLに `data-rr-id` を付与（既存IDは不変） |
| `rr run-next` | Queue先頭を1件処理 |
| `rr run-all` | Queueを順番に処理 |
| `rr pause` / `rr resume` / `rr stop-after-current` | Queue制御 |

## 設定 `.rr/config.yml`

```yaml
document:
  path: docs/requirements/index.html
  title: 要件定義レビュー
agent:
  type: claude-code
  command: claude            # 実行するエージェントコマンド名
  cwd: .
  timeout_seconds: 600
  permission_mode: acceptEdits  # ヘッドレス実行の権限モード（後述）
  extra_args: []                # claude に追加で渡す引数
  stream_progress: true         # stream-json で逐次進捗を取得（既定 true）
queue:
  auto_run: false
  mode: sequential
  state: paused
server:
  host: 127.0.0.1
  port: 5177
review:
  id_attribute: data-rr-id
  auto_inject_ids: true
diagrams:
  mermaid_version: 10.9.1     # 同梱した Mermaid のバージョン（CDN は使わない）
```

## 図（Mermaid / C4）の扱い

成果物に図を入れる場合は **Mermaid** を使い、ランタイムは**リポジトリ同梱（vendor）の
ファイルを相対パスで読み込みます。CDN 直参照は禁止**です（rr の iframe で XSS が成立すると
Claude Code の権限経路に波及しうるため）。

- 規約の詳細は `rr init` が生成する `.rr/prompts/diagrams.md` にまとまっています。
  生成・反映プロンプト本体は肥大化させず、図が必要なときだけこのファイルを参照する作りです。
- 図ブロックは `<pre class="mermaid" data-rr-id="diag-XXX">…DSL…</pre>` の形にします。
  rr は図ブロック自体にだけコメントを許可し、内部 SVG/DSL には `data-rr-id` を付与しません。
- iframe 描画時に rr が `<base href>` を動的注入するため、成果物 HTML には `<base>` を書きません。
  パスは相対のみ（先頭 `/` 禁止）。リバースプロキシのサブパス配信でも動作します。

### Mermaid の取り込み・更新

同梱ファイルは固定バージョン + SHA-384（SRI）で管理します。更新時は次を実行し、
差分を PR でレビューしてからコミットします。

```bash
tools/rr/scripts/vendor-mermaid.sh 10.9.1
# -> tools/rr/assets/vendor/mermaid/<version>/mermaid.min.js と vendor.lock を更新
```

`.rr/config.yml` の `diagrams.mermaid_version` を同梱バージョンと一致させてください
（不一致だと `rr serve` 起動時に警告が出ます）。

## Claude のパーミッションについて（重要）

`rr` は `claude -p "<prompt>" --permission-mode <mode>` でヘッドレス実行します。
**ヘッドレス実行では対話的な権限確認ができません。** 既定の `default` モードのままだと、
Claude がファイル編集(Edit/Write)をしようとした時点で承認待ちになり、プロンプトを
出せずに**セッションがアボート(=生成が無言で失敗)** します。

そのため `rr` は既定で `permission_mode: acceptEdits` を使い、作業ディレクトリ内の
ファイル編集を自動承認します。これにより、UIの「生成してレビュー開始」やコメント反映が
人手の確認なしで完了します。

調整したい場合は `.rr/config.yml` の `agent.permission_mode`:

| 値 | 挙動 |
| --- | --- |
| `acceptEdits` | （既定）作業ディレクトリ内の編集を自動承認 |
| `default` | 承認が必要な操作でアボート。`.claude/settings.json` の `allow` で個別許可する運用向け |
| `bypassPermissions` | すべての権限確認を省略（隔離環境・サンドボックス向け） |

ツールを絞りたい場合は `extra_args` で `--allowedTools` 等を渡せます:

```yaml
agent:
  permission_mode: acceptEdits
  extra_args: ["--allowedTools", "Read,Edit,Write"]
```

## 生成の進捗・状態の見方とトラブルシュート

生成中は左ペインにオーバーレイで進捗が出ます。表示は **SSE ではなくポーリング**
(`GET /api/generate/status` を1.5秒ごと) で更新するため、**SSEをバッファする
リバースプロキシ(例: code-server の `/proxy/`)経由でも 0s で固まりません。**
経過秒数はサーバーの開始時刻からクライアント側で算出します。

生成開始時に**プリフライト検査**を行い、状態をバナー表示します:

- エージェントのバージョン(`claude --version`)
- ログイン状態(`claude auth status --json` の `loggedIn` / `authMethod` / `apiProvider`)

「**未ログイン**」や「**コマンドが見つからない**」場合は、長い生成に入る前に
即座にエラーとして表示されます(これが「0s経過のまま無反応」の主因でした。
ヘッドレスの `claude -p` は未ログイン/権限不足だと対話確認できず**無言でアボート**します)。

確認・対処:

```bash
claude auth status --json   # {"loggedIn":true,...} を確認
claude auth login           # 未ログインなら
# または ANTHROPIC_API_KEY / Bedrock 等の環境変数を設定
```

rr は `claude` を **自身の環境変数を引き継いで** 起動します(`spawn(..., {env: process.env})`)。
つまり rr を起動したシェルで `claude -p "test"` が通れば、rr からも同じ条件で通ります。

## アーキテクチャ

- **CLI** (`src/cli`) — commander ベース。各サブコマンド。
- **Server** (`src/server`) — Fastify + better-sqlite3。
  - `services/` — document / rrId / comment / queue / worker / claude / diff / eventBus
  - `routes/` — document / comment / queue / event(SSE)
- **Client** (`src/client`) — React + Vite。2ペイン構成（左: iframe成果物 / 右: レビュー操作）。

## API 概要

```
GET  /api/document            POST /api/document/inject-ids
GET  /api/comments            POST /api/comments
PATCH/DELETE /api/comments/:id
GET  /api/queue               POST /api/queue
POST /api/queue/run-next | run-all | pause | resume | stop-after-current
POST /api/queue/jobs/:jobId/remove | reorder
GET  /api/jobs/:jobId         GET /api/jobs/:jobId/diff
GET  /api/events              (SSE)
```

## テスト

```bash
npm run typecheck
npm test          # rr-id注入 / コメント / Queue / Claude実行mock
```

## 既知の制約 / 非ゴール (MVP)

- 認証・複数ユーザー同時編集・クラウド公開なし
- 単一ドキュメント（`docs/requirements/index.html`）のみ
- 図へのコメントは図ブロック（`pre.mermaid` / `figure[data-diagram]`）全体に対してのみ。
  Mermaid ノード単位や図内の行単位コメント（`diagram_line`）は未実装で、説明文は直下の
  `<p class="diagram-caption">` に対してコメントする運用
- 列単位・範囲指定コメントなし
- SVG編集・PR作成なし
- Structurizr のライブレンダリングは非対応（C4 風 Mermaid、必要時は事前レンダリング SVG を使う）

コメント種別とエージェント実行部分は拡張しやすい構造にしてあります。
