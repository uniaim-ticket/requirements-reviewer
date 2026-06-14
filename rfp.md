# Claude Code 実装指示書：`rr` — 要件HTML成果物レビューUI

## 0. 作りたいもの

任意のリポジトリ内で起動できる、HTML成果物ベースのレビュー・修正UIを作成してください。

コマンド名は `rr` とします。

このツールは、Claude Codeなどで作成された要件定義HTMLをブラウザ上に表示し、人間がその成果物に対してレビューコメントを付け、そのコメントをQueueに積み、Claude Codeに順番に反映させるためのローカルアプリです。

重要なのは、チャットではなく **成果物そのものを見ながら、成果物に直接コメントし、そのコメントを順番に処理できること** です。

## 1. 利用イメージ

対象リポジトリで以下のように使います。

```bash
cd /path/to/target-repository

# 初期化
rr init

# レビューUI起動
rr serve
```

ブラウザUIから、またはCLIから、初版生成を行います。

```bash
rr generate
```

その後はブラウザ上で以下を行います。

```text
1. 要件定義HTMLを見る
2. 全体にかかる指摘を付ける
3. 行単位・ブロック単位の指摘を付ける
4. 指摘をQueueに積む
5. Queueを順番に処理する
6. Claude CodeがHTMLを修正する
7. 更新あり・Claudeコメント・diffをUIで確認する
8. 必要ならさらにコメントする
```

## 2. 基本コンセプト

このアプリは「チャットUI」ではありません。

中心にあるのは常にHTML成果物です。

```text
HTML成果物
  ↓
人間のレビューコメント
  ↓
Queue
  ↓
Claude Codeによる修正
  ↓
HTML成果物の更新
  ↓
人間が再レビュー
```

人間とClaude Codeのやり取りは、通常のチャット履歴ではなく、HTML成果物・コメント・Queue・diffとして管理します。

## 3. 対象成果物

対象は、要件定義・設計検討・調査結果などを表す単一HTMLです。

デフォルトの成果物パスは以下です。

```text
docs/requirements/index.html
```

HTMLには以下のような要素が含まれる想定です。

```text
- h1 / h2 / h3
- p
- ul / ol / li
- table / tr / th / td
- callout
- option card
- split layout
- diagram風のpreformatted block
- 今後はMermaidやフロー図
```

MVPでは、まず通常HTML・表・カード・左右分割・diagram風テキストブロックを扱えればよいです。

## 4. コメント種別

コメントは大きく2種類にしてください。

### 4.1 全体指摘

成果物全体、章全体、または現在のHTML全体に対する指摘です。

例:

```text
- 全体的に実装方針が強すぎるので、未確定事項をもっと分けてください
- 仕様確認事項を最後にまとめてください
- 表現を要件定義寄りではなく、設計検討寄りにしてください
- 今回は既存実装に対する選択肢比較を厚くしてください
```

DB上の `target_type` は以下にします。

```text
global
```

保存例:

```json
{
  "targetType": "global",
  "comment": "全体的に、確定事項と推測を分けてください"
}
```

### 4.2 行単位・ブロック単位の指摘

HTML上の特定箇所に対する指摘です。

「行単位」とは、HTMLソースの物理行ではなく、ブラウザ上で見える意味的な1単位です。

対象例:

```text
- 段落
- 箇条書き1行
- 表の1行
- 表の1セル
- callout
- option card
- pro / con の片側
- diagram風ブロックの1行
```

DB上の `target_type` は以下を許可してください。

```text
line
block
table_row
table_cell
diagram_line
```

MVPでは最低限以下を実装してください。

```text
global
line
block
table_row
table_cell
```

保存例:

```json
{
  "targetType": "line",
  "reviewId": "p-001",
  "selectedText": "既存の数量チェックは1申込内しか見ない",
  "comment": "ここは『過去保有・同一カート・進行中申込』の3分類を明示してください"
}
```

表行の例:

```json
{
  "targetType": "table_row",
  "reviewId": "tbl-001-r003",
  "comment": "この行に、追加するべき判定関数の候補も書いてください"
}
```

## 5. レビューID

HTML上のレビュー可能単位には `data-rr-id` を付与してください。

`data-review-id` ではなく、今回のアプリ名に合わせて `data-rr-id` にします。

例:

```html
<h2 data-rr-id="sec-001">1. 要件の本質</h2>

<p data-rr-id="p-001">
  ここに本文が入ります。
</p>

<table data-rr-id="tbl-001">
  <tr data-rr-id="tbl-001-r001">
    <td data-rr-id="tbl-001-r001-c001">項目</td>
    <td data-rr-id="tbl-001-r001-c002">内容</td>
  </tr>
</table>
```

既存HTMLに `data-rr-id` がない場合は、`rr inject-ids` で自動付与してください。

既にある `data-rr-id` は変更しないでください。

## 6. コマンド仕様

### 6.1 `rr init`

```bash
rr init
```

以下を作成してください。

```text
.rr/
  config.yml
  prompts/
    initial.md
    apply_comment.md
  rr.db

docs/
  requirements/
    index.html
```

初期設定例:

```yaml
document:
  path: docs/requirements/index.html
  title: 要件定義レビュー

agent:
  type: claude-code
  command: claude
  cwd: .
  timeout_seconds: 600

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
```

### 6.2 `rr serve`

```bash
rr serve
```

レビューUIを起動してください。

起動時表示:

```text
rr - Requirements Review

Document: docs/requirements/index.html
Server:   http://127.0.0.1:5177
Queue:    paused
Agent:    claude
```

### 6.3 `rr generate`

```bash
rr generate
```

または

```bash
rr generate --prompt "このシステムについて、券種をまたぐ購入制約の実装方式を検討してください"
```

または

```bash
rr generate --prompt-file .rr/prompts/initial.md
```

初版生成は、システム化要件を強く縛りすぎないでください。

人間が短いプロンプトを与え、Claude Codeが既存システムを見て検討し、結果をHTMLに出す、という形にします。

`rr generate` は、人間のプロンプトに最低限の出力形式指定だけを足してClaude Codeへ渡してください。

### 6.4 `rr inject-ids`

```bash
rr inject-ids
```

既存HTMLに `data-rr-id` を付与してください。

### 6.5 `rr run-next`

```bash
rr run-next
```

Queueの先頭を1件だけ処理してください。

### 6.6 `rr run-all`

```bash
rr run-all
```

Queueを順番に処理してください。

### 6.7 Queue制御

```bash
rr pause
rr resume
rr stop-after-current
```

それぞれQueueを制御してください。

## 7. 初版生成プロンプト

`.rr/prompts/initial.md` の初期値は短くしてください。

過度にシステム化要件を指定しないでください。

初期値:

```text
この既存システムについて、指定されたテーマを調査・検討し、要件定義または設計検討の初版をHTMLで作成してください。

出力先:
docs/requirements/index.html

出力形式:
- 単一HTML
- 日本語
- 見出し、本文、表、補足枠、比較案を使って読みやすく整理する
- レビュー可能な主要要素に data-rr-id を付与する
- 確定事項、推測、未確認事項をできるだけ分ける
```

`rr generate --prompt` が指定された場合は、次のように合成してください。

```text
[人間の指示]
{{user_prompt}}

[出力形式]
- docs/requirements/index.html に単一HTMLとして出力してください
- 日本語で書いてください
- 見出し、本文、表、補足枠、比較案を使って読みやすく整理してください
- レビュー可能な主要要素に data-rr-id を付与してください
- 確定事項、推測、未確認事項をできるだけ分けてください
```

これ以上、最初から詳細な設計制約を押し付けないでください。

## 8. コメント適用プロンプト

`.rr/prompts/apply_comment.md` は以下にしてください。

```text
あなたは、HTML成果物に付けられた人間のレビューコメントを反映するエージェントです。

対象ファイル:
{{document_path}}

コメント種別:
{{target_type}}

対象:
{{target_description}}

人間の指摘:
{{comment}}

対象HTML:
{{target_html}}

周辺HTML:
{{context_html}}

依頼:
- 人間の指摘を反映して、対象HTML成果物を修正してください。
- コメント種別が global の場合は、成果物全体を見て必要な箇所を修正してください。
- コメント種別が line / block / table_row / table_cell の場合は、対象箇所を中心に必要最小限で修正してください。
- data-rr-id を削除・変更しないでください。
- 新しい要素を追加する場合は data-rr-id を付与してください。
- HTML構造とCSSクラスを不用意に壊さないでください。
- 不明点がある場合でも、可能な範囲で部分適用してください。
- 判断が必要な箇所は「未確認」「要確認」「TODO」などとして本文に残してください。

完了後、以下のJSONで結果を返してください。

{
  "status": "applied | partially_applied | needs_human_review | conflicted | failed",
  "summary": "変更内容の要約",
  "changedRrIds": ["..."],
  "commentForReviewer": "人間に表示するコメント",
  "needsFollowUp": false
}
```

## 9. UI仕様

### 9.1 画面構成

画面は2ペイン構成にしてください。

```text
┌──────────────────────────────────────┬─────────────────────────────┐
│ HTML成果物                            │ レビュー操作                 │
│                                      │                             │
│ 要件定義・設計検討HTML               │ 全体指摘                     │
│                                      │ 行単位指摘                   │
│ クリック・選択してコメント           │ Queue                       │
│                                      │ 実行結果                     │
│                                      │ diff                        │
└──────────────────────────────────────┴─────────────────────────────┘
```

左ペイン:

* HTML成果物をiframe表示
* 元HTMLの見た目を維持
* `data-rr-id` を持つ要素をhover可能にする
* コメント済み箇所にマーカー表示
* 行単位・ブロック単位コメントを作れる
* 表行・表セルコメントを作れる

右ペイン:

* 全体指摘フォーム
* 選択箇所への指摘フォーム
* コメント一覧
* Queue
* 実行結果
* diff

### 9.2 全体指摘UI

右ペインの上部に、常に「全体指摘」フォームを出してください。

入力欄:

```text
この成果物全体への指摘を書く
```

ボタン:

```text
Save
Save and Queue
```

### 9.3 行単位指摘UI

HTML上で `data-rr-id` を持つ要素をhoverすると、コメントボタンを出してください。

対象:

```text
p
li
h2
h3
tr
td
th
.callout
.opt
.pro
.con
.diagram
```

コメント作成時には、以下を表示してください。

```text
対象: p-001
種別: line
選択テキスト: ...
コメント:
[textarea]

Save
Save and Queue
```

### 9.4 表への指摘

表は以下をサポートしてください。

```text
- セル単位コメント
- 行単位コメント
```

列単位・範囲指定はMVPでは不要です。

### 9.5 diagramへの指摘

MVPでは `.diagram` 全体へのコメントだけで構いません。

可能であれば、diagram内の表示行単位コメントも実装してください。

## 10. Queue仕様

コメントは作成後、すぐにClaude Codeへ投げないでください。

以下のいずれかでQueueに入れます。

```text
- Save and Queue
- コメント一覧からQueueに追加
- 複数コメントを選んでQueueに追加
```

MVPでは、1コメント = 1 jobで構いません。

Queue操作:

```text
Run next
Run all
Pause
Resume
Stop after current
Remove
Reorder
```

必須:

```text
Run next
Run all
Pause
Resume
Stop after current
Remove
```

Queueは同一HTML成果物に対して直列処理してください。

## 11. DB設計

SQLiteを使用してください。

### 11.1 documents

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  html_path TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 11.2 comments

```sql
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  document_version INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  rr_id TEXT,
  table_rr_id TEXT,
  row_index INTEGER,
  col_index INTEGER,
  selected_text TEXT,
  prefix TEXT,
  suffix TEXT,
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`target_type`:

```text
global
line
block
table_row
table_cell
diagram
diagram_line
```

### 11.3 jobs

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  document_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  position INTEGER NOT NULL,
  claude_process_id INTEGER,
  claude_summary TEXT,
  claude_raw_output TEXT,
  diff_text TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
```

### 11.4 job_comments

```sql
CREATE TABLE job_comments (
  job_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  PRIMARY KEY(job_id, comment_id)
);
```

### 11.5 app_state

```sql
CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 12. API仕様

Fastifyで実装してください。

### 12.1 Document

```http
GET /api/document
POST /api/document/inject-ids
```

### 12.2 Comments

```http
GET /api/comments
POST /api/comments
PATCH /api/comments/:id
DELETE /api/comments/:id
```

### 12.3 Queue

```http
GET /api/queue
POST /api/queue
POST /api/queue/run-next
POST /api/queue/run-all
POST /api/queue/pause
POST /api/queue/resume
POST /api/queue/stop-after-current
POST /api/queue/jobs/:jobId/remove
POST /api/queue/jobs/:jobId/reorder
```

### 12.4 Results

```http
GET /api/jobs/:jobId
GET /api/jobs/:jobId/diff
```

### 12.5 Events

SSEで実装してください。

```http
GET /api/events
```

イベント:

```text
document_updated
comment_created
comment_updated
job_queued
job_started
job_completed
job_failed
queue_paused
queue_resumed
```

## 13. Claude Code連携

### 13.1 実行方式

Node.jsから `claude` コマンドを実行してください。

MVPではCLI実行で構いません。

```bash
claude -p "<prompt>"
```

設定でコマンド名を変更できるようにしてください。

```yaml
agent:
  command: claude
```

### 13.2 初版生成

`rr generate` では、人間のプロンプトを尊重してください。

アプリ側が付け足すのは、基本的に出力先とHTMLフォーマットの短い指定だけにしてください。

### 13.3 コメント反映

Queue job処理時は以下をClaude Codeへ渡してください。

```text
- 対象HTMLファイルパス
- コメント種別
- 人間の指摘
- 対象HTML断片
- 周辺HTML
- globalの場合はHTML全体または章構成要約
```

Claude Code実行前には必ずHTMLのバックアップを作成してください。

処理後に以下を保存してください。

```text
- ClaudeのJSON結果
- raw output
- diff
- status
```

## 14. diffと更新検知

### 14.1 diff

git管理されている場合:

```bash
git diff -- docs/requirements/index.html
```

git管理されていない場合:

```text
実行前バックアップと実行後HTMLの文字列diff
```

### 14.2 更新通知

HTML更新時にSSEでUIへ通知してください。

UIでは以下を表示してください。

```text
更新あり
Claudeコメントあり
diffあり
```

ユーザーが確認できるようにしてください。

## 15. フロントエンド構成

```text
src/client/
  App.tsx
  api.ts
  types.ts

  components/
    DocumentFrame.tsx
    GlobalCommentBox.tsx
    InlineCommentPopover.tsx
    Sidebar.tsx
    CommentsPanel.tsx
    QueuePanel.tsx
    ResultPanel.tsx
    DiffPanel.tsx

  hooks/
    useDocumentFrame.ts
    useComments.ts
    useQueue.ts
    useEvents.ts
```

## 16. バックエンド構成

```text
src/server/
  index.ts
  config.ts
  db.ts
  migrations.ts

  routes/
    documentRoutes.ts
    commentRoutes.ts
    queueRoutes.ts
    eventRoutes.ts

  services/
    documentService.ts
    rrIdService.ts
    commentService.ts
    queueService.ts
    workerService.ts
    claudeService.ts
    diffService.ts
    eventBus.ts
```

## 17. CLI構成

```text
src/cli/
  index.ts
  commands/
    init.ts
    serve.ts
    generate.ts
    injectIds.ts
    runNext.ts
    runAll.ts
    pause.ts
    resume.ts
    stopAfterCurrent.ts
```

## 18. package.json

`tools/rr/package.json` を作成してください。

```json
{
  "name": "rr",
  "private": true,
  "type": "module",
  "bin": {
    "rr": "./dist/cli/index.js"
  },
  "scripts": {
    "dev": "tsx src/server/index.ts",
    "cli": "tsx src/cli/index.ts",
    "build": "vite build && tsc -p tsconfig.server.json",
    "start": "node dist/server/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

## 19. 実装順序

以下の順に実装してください。

### Phase 1: CLIとサーバー

1. `tools/rr/` を作成
2. TypeScript / React / Vite / Fastify / SQLiteを設定
3. `rr init` を実装
4. `rr serve` を実装
5. `GET /api/document` を実装
6. iframeでHTML表示

### Phase 2: rr-id

7. `data-rr-id` 注入処理を実装
8. `rr inject-ids` を実装
9. hover時のアウトライン表示を実装

### Phase 3: コメント

10. 全体指摘フォームを実装
11. 行単位・ブロック単位コメントを実装
12. 表行・表セルコメントを実装
13. コメント一覧を実装

### Phase 4: Queue

14. Queue DB処理を実装
15. Save and Queueを実装
16. Run next / Run allを実装
17. Pause / Resume / Stop after currentを実装

### Phase 5: Claude連携

18. Claude Code実行処理を実装
19. apply_comment prompt生成を実装
20. 対象HTML断片抽出を実装
21. backup作成を実装
22. diff保存を実装
23. 実行結果表示を実装

### Phase 6: 更新通知

24. SSEを実装
25. HTML更新検知を実装
26. UIに更新あり表示を実装

### Phase 7: テストとREADME

27. rr-id注入テスト
28. コメント保存テスト
29. Queue処理テスト
30. Claude実行mockテスト
31. README作成

## 20. 受け入れ条件

以下ができればMVP完了です。

```bash
rr init
rr serve
rr generate --prompt "この既存システムについて、券種をまたぐ購入制約の実装方式を検討してください"
```

ブラウザで以下ができること。

```text
- HTML成果物が表示される
- 全体指摘を書ける
- 行単位指摘を書ける
- 表行・表セルに指摘を書ける
- 指摘をQueueに積める
- QueueをRun nextできる
- QueueをRun allできる
- QueueをPause/Resumeできる
- Claude CodeがHTMLを修正する
- 更新あり表示が出る
- Claudeコメントが表示される
- diffが表示される
```

## 21. 非ゴール

MVPでは以下は不要です。

```text
- 認証
- 複数ユーザー同時編集
- クラウド公開
- Redis
- PostgreSQL
- PR作成
- Mermaidノード単位コメント
- SVG編集
- 複数ドキュメント管理
```

ただし、将来的に追加できるように、コメント種別とagent実行部分は拡張しやすくしてください。

## 22. 実装時の重要制約

* コマンド名は `rr`
* 設定ディレクトリは `.rr/`
* アプリ本体は `tools/rr/`
* レビューID属性は `data-rr-id`
* 初版生成プロンプトは短く保つ
* 人間のプロンプトを尊重する
* アプリ側で過度な設計方針を押し付けない
* 全体指摘と行単位指摘を必ず分ける
* 成果物HTMLを中心にしたインタラクションにする
* コメントは必ずQueueに積めるようにする
* Queueは停止・再開できるようにする
* HTML更新・Claudeコメント・diffをUIに表示する
* `data-rr-id` は削除・変更しない
* Claude Code実行前にHTMLをバックアップする
* 同一HTMLへのjobは直列処理する

## 23. 最終報告

実装後、以下を実行してください。

```bash
cd tools/rr
npm install
npm run typecheck
npm test
npm run build
```

最後に以下を報告してください。

```text
- 実装した機能
- 作成した主要ファイル
- 起動方法
- 動作確認手順
- 未実装の範囲
- 注意点
- 次に実装するとよいこと
```

