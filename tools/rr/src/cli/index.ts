#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runServe } from "./commands/serve.js";
import { runGenerate } from "./commands/generate.js";
import { runInjectIds } from "./commands/injectIds.js";
import { runRunNext } from "./commands/runNext.js";
import { runRunAll } from "./commands/runAll.js";
import { runPause } from "./commands/pause.js";
import { runResume } from "./commands/resume.js";
import { runStopAfterCurrent } from "./commands/stopAfterCurrent.js";

const program = new Command();

program
  .name("rr")
  .description("rr - Requirements Review: HTML成果物ベースのレビュー・修正UI")
  .version("0.1.0");

program
  .command("init")
  .description("プロジェクトに .rr/ と docs/requirements/index.html を作成")
  .action(() => runInit());

program
  .command("serve", { isDefault: true })
  .description("レビューUIを起動（未初期化なら自動でinitし、ブラウザを開く）")
  .option("--no-init", "未初期化でも自動initしない")
  .option("--no-open", "ブラウザを自動で開かない")
  .option("-p, --port <number>", "使用するポート（既定: 設定値、使用中なら自動で空きポート）")
  .action(async (opts) => {
    await runServe({
      autoInit: opts.init,
      open: opts.open,
      port: opts.port ? Number(opts.port) : undefined,
    });
  });

program
  .command("generate")
  .description("Claude Code で初版を生成（既定で新しい要件ドキュメントを作成）")
  .option("--prompt <text>", "人間のプロンプト")
  .option("--prompt-file <path>", "プロンプトファイルのパス")
  .option("--title <text>", "新しい要件のタイトル")
  .option("--current", "新規作成せず、現在のドキュメントを再生成")
  .action(async (opts) => {
    await runGenerate({
      prompt: opts.prompt,
      promptFile: opts.promptFile,
      title: opts.title,
      current: opts.current,
    });
  });

program
  .command("inject-ids")
  .description("既存HTMLに data-rr-id を付与")
  .action(() => runInjectIds());

program
  .command("run-next")
  .description("Queueの先頭を1件処理")
  .action(async () => {
    await runRunNext();
  });

program
  .command("run-all")
  .description("Queueを順番に処理")
  .action(async () => {
    await runRunAll();
  });

program.command("pause").description("Queueを一時停止").action(() => runPause());
program.command("resume").description("Queueを再開").action(() => runResume());
program
  .command("stop-after-current")
  .description("現在のジョブ完了後に停止")
  .action(() => runStopAfterCurrent());

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`エラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
