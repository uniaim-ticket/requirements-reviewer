import { describe, it, expect } from "vitest";
import { injectIds, extractTarget } from "../src/server/services/rrIdService.js";

describe("injectIds", () => {
  it("adds data-rr-id to reviewable elements without ids", () => {
    const html = "<body><h2>見出し</h2><p>本文</p><li>項目</li></body>";
    const { html: out, added } = injectIds(html);
    expect(added).toBeGreaterThanOrEqual(3);
    expect(out).toContain('data-rr-id="sec-001"');
    expect(out).toContain('data-rr-id="p-001"');
    expect(out).toContain('data-rr-id="li-001"');
  });

  it("does not change existing data-rr-id", () => {
    const html = '<p data-rr-id="custom-99">既存</p><p>新規</p>';
    const { html: out } = injectIds(html);
    expect(out).toContain('data-rr-id="custom-99"');
    expect(out).toContain('data-rr-id="p-001"');
  });

  it("assigns hierarchical ids to tables, rows, and cells", () => {
    const html =
      "<table><tr><th>A</th><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>";
    const { html: out } = injectIds(html);
    expect(out).toContain('data-rr-id="tbl-001"');
    expect(out).toContain('data-rr-id="tbl-001-r001"');
    expect(out).toContain('data-rr-id="tbl-001-r001-c001"');
    expect(out).toContain('data-rr-id="tbl-001-r002-c002"');
  });

  it("is idempotent (running twice adds nothing new)", () => {
    const html = "<body><p>本文</p><h3>章</h3></body>";
    const first = injectIds(html);
    const second = injectIds(first.html);
    expect(second.added).toBe(0);
    expect(second.html).toBe(first.html);
  });

  it("recognizes class-based reviewable units", () => {
    const html =
      '<div class="callout">注</div><div class="opt"><span class="pro">良</span></div>';
    const { html: out } = injectIds(html);
    expect(out).toContain('data-rr-id="callout-001"');
    expect(out).toContain('data-rr-id="opt-001"');
    expect(out).toContain('data-rr-id="pro-001"');
  });
});

describe("extractTarget", () => {
  it("returns the outer html for a given rr-id", () => {
    const html = '<div><p data-rr-id="p-001">本文です</p></div>';
    const { targetHtml, contextHtml } = extractTarget(html, "p-001");
    expect(targetHtml).toContain("本文です");
    expect(contextHtml).toContain("<div>");
  });

  it("returns null when the id is missing", () => {
    const { targetHtml } = extractTarget("<p>x</p>", "missing");
    expect(targetHtml).toBeNull();
  });
});
