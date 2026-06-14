// Static templates emitted by `rr init`.

// .rr/.gitignore — keep config + prompts under version control, but ignore the
// local SQLite DB, its WAL/SHM sidecars, and the pre-run HTML backups.
export const RR_GITIGNORE = `# rr local state (do not commit)
rr.db
rr.db-shm
rr.db-wal
backups/
`;

export const CONFIG_YML = `document:
  path: docs/requirements/index.html
  title: 要件定義レビュー

agent:
  type: claude-code
  command: claude
  cwd: .
  timeout_seconds: 600
  # ヘッドレス(-p)実行では、既定モードだとファイル編集の承認待ちでアボートします。
  # acceptEdits は作業ディレクトリ内の編集を自動承認します（rr の生成・反映に必要）。
  # より厳格にしたい場合は default にし、.claude/settings.json の allow で許可してください。
  # 隔離環境で完全に承認を省く場合は bypassPermissions。
  permission_mode: acceptEdits
  # claude コマンドに追加で渡す引数（例: ["--allowedTools", "Read,Edit,Write"]）
  extra_args: []
  # 既定で前回セッションを --resume し、要件理解を深めた状態で次の指摘を反映します。
  # 再開できない場合は、過去の検討要約をプロンプトに注入して文脈を呼び起こします。
  resume_session: true

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
  # 図の描画に使う Mermaid のバージョン。tools/rr/assets/vendor/mermaid/<version>/
  # に同梱したファイルと一致させること（CDN からは読み込まない）。
  # 取り込み: tools/rr/scripts/vendor-mermaid.sh <version>
  mermaid_version: 10.9.1
`;

export const INITIAL_PROMPT_MD = `この既存システムについて、指定されたテーマを調査・検討し、要件定義または設計検討の初版をHTMLで作成してください。

出力先:
docs/requirements/index.html

出力形式:
- 単一HTML
- 日本語
- 見出し、本文、表、補足枠、比較案を使って読みやすく整理する
- レビュー可能な主要要素に data-rr-id を付与する
- 確定事項、推測、未確認事項をできるだけ分ける

図表について:
- フロー図・構成図など図が有効な場合のみ Mermaid を使う（不要なら使わない）。
- 図を入れるときは、必ず .rr/prompts/diagrams.md を読み、その規約に従う（CDN 禁止・相対パス・data-rr-id の付け方など）。
`;

export const APPLY_COMMENT_MD = `あなたは、HTML成果物に付けられた人間のレビューコメントを反映するエージェントです。

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
- まず {{document_path}} の成果物全体を読み込み、文書全体の構成・前提・用語・整合性を把握してください。指摘箇所だけを見て局所的に直すのではなく、文書全体を踏まえて要件を確認・修正してください。
- 人間の指摘を反映して、対象HTML成果物を修正してください。指摘の対象箇所が起点ですが、その指摘によって整合性が崩れる他の箇所（関連する記述・表・前提・章のつながり・用語の統一・確定/推測/未確認の区分など）があれば、全体を見渡して併せて修正してください。
- コメント種別が global の場合は、成果物全体を見て必要な箇所を修正してください。
- コメント種別が line / block / table_row / table_cell の場合でも、対象箇所を起点としつつ、文書全体の整合性を保つために必要な範囲で関連箇所も修正してください（無関係な箇所を不必要に書き換えないこと）。
- data-rr-id を削除・変更しないでください。
- 新しい要素を追加する場合は data-rr-id を付与してください。
- HTML構造とCSSクラスを不用意に壊さないでください。
- 不明点がある場合でも、可能な範囲で部分適用してください。
- 判断が必要な箇所は「未確認」「要確認」「TODO」などとして本文に残してください。
- changedRrIds には、対象箇所だけでなく全体整合のために変更したすべての data-rr-id を列挙してください。
- 図（Mermaid 等）を追加・編集する場合は .rr/prompts/diagrams.md の規約に従ってください。既存の図はローダ部や class 名を変えず、原則 DSL のみ書き換えます。

完了後、以下のJSONで結果を返してください。

{
  "status": "applied | partially_applied | needs_human_review | conflicted | failed",
  "summary": "変更内容の要約",
  "changedRrIds": ["..."],
  "commentForReviewer": "人間に表示するコメント",
  "needsFollowUp": false
}
`;

// On-demand diagram standard. Kept OUT of the main prompts (which only point
// here) so generation/apply prompts stay lean — Claude reads this only when it
// actually needs a diagram. Versioned via {{mermaid_version}} on `rr init`.
export const DIAGRAMS_MD = `# 図表の作成規約（Mermaid / C4）

図（フロー図・構成図など）が必要なときだけ、この規約に従って作成する。
不要な図は作らない。

## 前提（なぜ厳しいか）
成果物 HTML は rr の画面で iframe(srcDoc) に埋め込まれて描画される。
iframe 内で XSS が成立すると Claude Code の権限経路に波及しうるため、
**図のランタイムはリポジトリ同梱（vendor）のものだけを読み込む。CDN 直参照は禁止。**

## 必須ルール
1. 図には **Mermaid** を使う。C4 視点が要るときは Mermaid の \`C4Context\` 等を使う。
2. ローダは \`<head>\` に下記の 1 セットだけ入れる（複数入れない）。
3. **CDN 禁止**（cdn.jsdelivr.net / unpkg.com 等から読み込まない）。同梱した vendor を読む。
4. **パスは相対パス（先頭スラッシュなし）**。リバースプロキシのサブパス配信で絶対パスは壊れる。
5. \`<base href>\` は成果物 HTML に書かない（rr が iframe 描画時に動的注入する）。
6. バージョンは固定（\`@latest\` 禁止）。同梱ファイルのバージョンと一致させる。

## 標準ローダ（<head> に入れる）
同梱の単一ファイル UMD ビルドを \`<script src integrity>\` で読む（SRI で改ざん検知）。

\`\`\`html
<script
  src="./vendor/mermaid/{{mermaid_version}}/mermaid.min.js"
  integrity="{{mermaid_integrity}}"
  crossorigin="anonymous"></script>
<script>
  // rr は srcDoc を都度書き換えるため startOnLoad:false ＋ 明示 run。
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
  document.addEventListener("DOMContentLoaded", () => {
    mermaid.run({ querySelector: "pre.mermaid" });
  });
</script>
\`\`\`

## 図ブロックの書き方
- 図は \`<pre class="mermaid" data-rr-id="diag-XXX">...DSL...</pre>\` の形にする（div ではなく pre）。
- **data-rr-id は図ブロック自体に 1 つだけ**。内部要素には付けない（Mermaid が SVG に置換する）。
- DSL 内は **HTML エスケープしない**（\`&lt;\` ではなく生の文字。\`-->\` や \`|...|\` もそのまま）。
- \`<pre>\` 内の行頭に余計なインデントを入れない（parse error の原因）。
- 図の説明は直下に \`<p class="diagram-caption" data-rr-id="...">\` で書き、そこにコメントできるようにする。
- note 等に \`<\` を含めない（HTML パーサが壊す）。「lt」等の語に置き換える。

\`\`\`html
<pre class="mermaid" data-rr-id="diag-flow-001">
flowchart LR
  A[要件入力] --> B[Claude 生成]
  B --> C[HTML レビュー]
  C --> D{合意?}
  D -->|Yes| E[反映]
  D -->|No| B
</pre>
<p class="diagram-caption" data-rr-id="diag-flow-001-cap">図1: レビューループ。</p>
\`\`\`

## C4（簡易）
\`\`\`html
<pre class="mermaid" data-rr-id="diag-c4-001">
C4Context
  title システムコンテキスト図
  Person(reviewer, "レビュア", "要件確認者")
  System(rr, "rr", "Requirements Reviewer")
  System_Ext(claude, "Claude Code", "生成・反映エージェント")
  Rel(reviewer, rr, "レビュー操作")
  Rel(rr, claude, "プロンプト送信", "CLI")
</pre>
\`\`\`

## 事前レンダリング SVG を使う場合（任意・ランタイム依存ゼロ）
- \`<figure data-diagram data-rr-id="diag-XXX">\` の中に \`<svg>\` をインライン展開（外部参照・<script> 禁止）。
- 直後に \`<details><summary>DSL</summary><pre class="diagram-src" data-diagram-kind="structurizr">...</pre></details>\` を必ず添える。

## 禁止・注意
- 同梱されていないバージョンや存在しない vendor パスを参照しない。
- 同梱が間に合わない場合は、CDN を使わず、図はテキスト要約か事前レンダリング SVG にする。
`;

// A small starter document so `rr serve` shows something before generation.
export const STARTER_HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>要件定義レビュー</title>
  <!-- 図のランタイムはリポジトリ同梱の vendor を相対パスで読み込む（CDN 禁止）。
       <base href> は書かない（rr が iframe 描画時に動的注入する）。詳細は .rr/prompts/diagrams.md。 -->
  <script
    src="./vendor/mermaid/{{mermaid_version}}/mermaid.min.js"
    integrity="{{mermaid_integrity}}"
    crossorigin="anonymous"></script>
  <script>
    // rr は srcDoc を都度書き換えるため startOnLoad:false ＋ 明示 run。
    if (window.mermaid) {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
      document.addEventListener("DOMContentLoaded", () => {
        mermaid.run({ querySelector: "pre.mermaid" });
      });
    }
  </script>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.7; max-width: 880px; margin: 2rem auto; padding: 0 1rem; color: #1f2937; }
    h1, h2, h3 { line-height: 1.3; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #d1d5db; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #f3f4f6; }
    .callout { border-left: 4px solid #3b82f6; background: #eff6ff; padding: 0.75rem 1rem; margin: 1rem 0; }
    pre.mermaid { background: #fff; }
    .diagram-caption { color: #6b7280; font-size: 14px; }
    .split { display: flex; gap: 1rem; }
    .opt { flex: 1; border: 1px solid #d1d5db; border-radius: 6px; padding: 1rem; }
    .pro { color: #065f46; }
    .con { color: #991b1b; }
  </style>
</head>
<body>
  <h1 data-rr-id="sec-001">要件定義レビュー（初期ドキュメント）</h1>
  <p data-rr-id="p-001">
    これは rr の初期ドキュメントです。<code>rr generate --prompt "..."</code> を実行すると、
    Claude Code が既存システムを調査して、この内容を置き換えます。
  </p>

  <div class="callout" data-rr-id="callout-001">
    <p data-rr-id="p-002">補足: レビュー可能な要素には data-rr-id が付与されます。ホバーしてコメントしてください。</p>
  </div>

  <h2 data-rr-id="sec-002">サンプル比較表</h2>
  <table data-rr-id="tbl-001">
    <tr data-rr-id="tbl-001-r001">
      <th data-rr-id="tbl-001-r001-c001">項目</th>
      <th data-rr-id="tbl-001-r001-c002">内容</th>
    </tr>
    <tr data-rr-id="tbl-001-r002">
      <td data-rr-id="tbl-001-r002-c001">確定事項</td>
      <td data-rr-id="tbl-001-r002-c002">ここに確定した要件を書きます。</td>
    </tr>
    <tr data-rr-id="tbl-001-r003">
      <td data-rr-id="tbl-001-r003-c001">未確認事項</td>
      <td data-rr-id="tbl-001-r003-c002">ここに要確認の項目を書きます。</td>
    </tr>
  </table>

  <div class="split">
    <div class="opt" data-rr-id="opt-001">
      <h3 data-rr-id="sec-003">案A</h3>
      <p class="pro" data-rr-id="pro-001">利点: ...</p>
      <p class="con" data-rr-id="con-001">欠点: ...</p>
    </div>
    <div class="opt" data-rr-id="opt-002">
      <h3 data-rr-id="sec-004">案B</h3>
      <p class="pro" data-rr-id="pro-002">利点: ...</p>
      <p class="con" data-rr-id="con-002">欠点: ...</p>
    </div>
  </div>

  <h2 data-rr-id="sec-005">サンプル図（Mermaid）</h2>
  <pre class="mermaid" data-rr-id="diag-001">
flowchart LR
  A[HTML成果物] --> B[レビュー]
  B --> C[Queue]
  C --> D[Claude修正]
  D --> A
</pre>
  <p class="diagram-caption" data-rr-id="diag-001-cap">図: レビューと反映のループ。</p>
</body>
</html>
`;
