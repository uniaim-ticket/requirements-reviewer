import fs from "node:fs";
import { requireProjectRoot } from "../../server/config.js";
import { createContext } from "../../server/context.js";

export interface GenerateOptions {
  prompt?: string;
  promptFile?: string;
  title?: string;
  /** Regenerate the current document instead of creating a new one. */
  current?: boolean;
}

export async function runGenerate(opts: GenerateOptions): Promise<void> {
  const root = requireProjectRoot();
  const ctx = createContext(root);

  let userPrompt = opts.prompt;
  if (opts.promptFile) {
    userPrompt = fs.readFileSync(opts.promptFile, "utf8");
  }

  // eslint-disable-next-line no-console
  console.log("初版を生成中... (claude を実行します)\n");
  const out = await ctx.generator.generate({
    prompt: userPrompt,
    title: opts.title,
    asNew: !opts.current,
  });

  // eslint-disable-next-line no-console
  console.log(`\n完了: ${out.status}`);
  if (out.summary) console.log(out.summary);
  // eslint-disable-next-line no-console
  console.log(`\nドキュメント: ${out.document.title} (${out.document.htmlPath})`);
}
