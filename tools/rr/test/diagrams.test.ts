import { describe, it, expect } from "vitest";
import {
  DIAGRAMS_MD,
  STARTER_HTML,
  INITIAL_PROMPT_MD,
  APPLY_COMMENT_MD,
} from "../src/cli/templates.js";

// Hard rules from docs/requirements/mermaid-structurizrの利用の標準化.html:
//  - CDN 直参照は禁止 (no jsdelivr/unpkg/etc.)
//  - 相対パスのみ (no leading-slash absolute asset paths)
//  - 同梱 vendor を参照する (./vendor/...)
describe("diagram templates obey the vendoring standard", () => {
  const CDN = /https?:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs|esm\.sh)/i;

  it("starter HTML loads mermaid from a relative vendor path, not a CDN", () => {
    expect(STARTER_HTML).toContain("./vendor/mermaid/");
    expect(STARTER_HTML).not.toMatch(CDN);
    // No leading-slash absolute src/href/import (breaks under a sub-path proxy).
    expect(STARTER_HTML).not.toMatch(/(?:src|href)="\/(?!\/)/);
    // Must NOT hardcode a real <base href="..."> tag — rr injects it into the
    // iframe at render time. (A mention in a comment is fine.)
    expect(STARTER_HTML).not.toMatch(/<base\s+href=/i);
    // Explicit init is required (startOnLoad:false) for SSE re-render.
    expect(STARTER_HTML).toContain("startOnLoad: false");
  });

  it("diagrams.md documents the no-CDN / relative-path rule", () => {
    expect(DIAGRAMS_MD).toContain("CDN");
    expect(DIAGRAMS_MD).toContain("./vendor/mermaid/");
    expect(DIAGRAMS_MD).not.toMatch(CDN);
  });

  it("main prompts only point at diagrams.md (kept lean)", () => {
    // The detailed standard lives in diagrams.md; prompts merely reference it.
    expect(INITIAL_PROMPT_MD).toContain("diagrams.md");
    expect(APPLY_COMMENT_MD).toContain("diagrams.md");
    // The heavy loader snippet must NOT be inlined into the main prompts.
    expect(INITIAL_PROMPT_MD).not.toContain("mermaid.min.js");
  });
});
