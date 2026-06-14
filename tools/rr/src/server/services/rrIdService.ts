import { parse, HTMLElement } from "node-html-parser";

// Elements that become reviewable units. Order matters only for readability.
const REVIEWABLE_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "li",
  "td",
  "th",
  "tr",
  "table",
  "blockquote",
  "pre",
]);

// Class-based reviewable units (callout / option card / pro / con / diagram).
const REVIEWABLE_CLASSES = ["callout", "opt", "pro", "con", "diagram"];

const ID_ATTR = "data-rr-id";

interface Counters {
  [prefix: string]: number;
}

function prefixForElement(el: HTMLElement): string {
  const tag = el.tagName?.toLowerCase() ?? "";
  const classes = (el.getAttribute("class") ?? "").split(/\s+/);
  if (classes.includes("callout")) return "callout";
  if (classes.includes("opt")) return "opt";
  if (classes.includes("pro")) return "pro";
  if (classes.includes("con")) return "con";
  if (classes.includes("diagram")) return "diag";
  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
      return "sec";
    case "p":
      return "p";
    case "li":
      return "li";
    case "table":
      return "tbl";
    case "pre":
      return "pre";
    case "blockquote":
      return "bq";
    default:
      return tag || "el";
  }
}

function nextId(counters: Counters, prefix: string): string {
  const n = (counters[prefix] ?? 0) + 1;
  counters[prefix] = n;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

function isReviewable(el: HTMLElement): boolean {
  const tag = el.tagName?.toLowerCase() ?? "";
  if (REVIEWABLE_TAGS.has(tag)) return true;
  const classes = (el.getAttribute("class") ?? "").split(/\s+/);
  return REVIEWABLE_CLASSES.some((c) => classes.includes(c));
}

/**
 * Inject data-rr-id attributes into reviewable elements that don't already
 * have one. Existing ids are never changed (RFP §5). Tables get hierarchical
 * ids: tbl-001 / tbl-001-r001 / tbl-001-r001-c001.
 *
 * Returns the rewritten HTML and the count of newly added ids.
 */
export function injectIds(
  html: string,
  idAttr: string = ID_ATTR,
): { html: string; added: number } {
  const root = parse(html, {
    comment: true,
    voidTag: { closingSlash: true },
  });
  const counters: Counters = {};
  let added = 0;

  // First pass: collect existing ids so generated ids never collide.
  const used = new Set<string>();
  root.querySelectorAll(`[${idAttr}]`).forEach((el) => {
    const v = el.getAttribute(idAttr);
    if (v) used.add(v);
  });

  function assign(el: HTMLElement, candidate: () => string): void {
    if (el.getAttribute(idAttr)) return; // preserve existing
    let id = candidate();
    while (used.has(id)) id = candidate();
    used.add(id);
    el.setAttribute(idAttr, id);
    added++;
  }

  // Tables first, so rows/cells get hierarchical ids tied to the table id.
  root.querySelectorAll("table").forEach((table) => {
    assign(table, () => nextId(counters, "tbl"));
    const tableId = table.getAttribute(idAttr)!;
    const rows = table.querySelectorAll("tr");
    rows.forEach((row, rIdx) => {
      const rowId = `${tableId}-r${String(rIdx + 1).padStart(3, "0")}`;
      if (!row.getAttribute(idAttr)) {
        row.setAttribute(idAttr, rowId);
        used.add(rowId);
        added++;
      }
      const cells = row.querySelectorAll("td, th");
      cells.forEach((cell, cIdx) => {
        const cellId = `${row.getAttribute(idAttr)}-c${String(cIdx + 1).padStart(3, "0")}`;
        if (!cell.getAttribute(idAttr)) {
          cell.setAttribute(idAttr, cellId);
          used.add(cellId);
          added++;
        }
      });
    });
  });

  // Then non-table reviewable elements.
  root.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName?.toLowerCase() ?? "";
    if (tag === "table" || tag === "tr" || tag === "td" || tag === "th") return;
    if (!isReviewable(el)) return;
    assign(el, () => nextId(counters, prefixForElement(el)));
  });

  return { html: root.toString(), added };
}

/**
 * Extract the outerHTML of the element bearing a given rr-id, plus a little
 * surrounding context (parent's inner HTML), for the apply-comment prompt.
 */
export function extractTarget(
  html: string,
  rrId: string,
  idAttr: string = ID_ATTR,
): { targetHtml: string | null; contextHtml: string | null } {
  const root = parse(html);
  const el = root.querySelector(`[${idAttr}="${rrId}"]`);
  if (!el) return { targetHtml: null, contextHtml: null };
  const parent = el.parentNode as HTMLElement | null;
  return {
    targetHtml: el.toString(),
    contextHtml: parent ? parent.toString() : el.toString(),
  };
}
