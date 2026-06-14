import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import type { Comment, InlineTarget, TargetType } from "../types.js";

// CSS injected into the iframe to support hover outlines + comment markers.
const FRAME_CSS = `
[data-rr-id] { position: relative; }
[data-rr-id].rr-hover { outline: 2px solid #3b82f6 !important; outline-offset: 1px; cursor: pointer; }
[data-rr-id].rr-commented { background: rgba(251, 191, 36, 0.18) !important; }
[data-rr-id].rr-selected { outline: 2px dashed #2563eb !important; }
.rr-comment-btn {
  position: absolute; top: 0; right: 0; transform: translate(0, -100%);
  background: #2563eb; color: #fff; border: none; border-radius: 4px;
  font-size: 11px; padding: 2px 6px; cursor: pointer; z-index: 99999;
  font-family: system-ui, sans-serif;
}
[data-rr-id].rr-flash { animation: rr-flash-kf 1.6s ease-out; }
@keyframes rr-flash-kf {
  0% { background: rgba(37, 99, 235, 0.45); box-shadow: 0 0 0 3px rgba(37,99,235,0.45); }
  100% { background: transparent; box-shadow: none; }
}
`;

// Map an element to a TargetType based on its tag/class.
function classifyTarget(el: Element): TargetType {
  const tag = el.tagName.toLowerCase();
  const cls = el.classList;
  if (tag === "tr") return "table_row";
  if (tag === "td" || tag === "th") return "table_cell";
  if (cls.contains("diagram")) return "diagram";
  if (tag === "li" || tag === "p") return "line";
  return "block";
}

interface UseDocumentFrameArgs {
  comments: Comment[];
  onPickTarget: (t: InlineTarget) => void;
}

export function useDocumentFrame({ comments, onPickTarget }: UseDocumentFrameArgs) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [html, setHtml] = useState<string>("");
  const [idAttr, setIdAttr] = useState<string>("data-rr-id");
  const [exists, setExists] = useState(true);
  const pickRef = useRef(onPickTarget);
  pickRef.current = onPickTarget;

  const reload = useCallback(async () => {
    const res = await api.getDocument();
    setHtml(res.html);
    setIdAttr(res.idAttribute);
    setExists(res.exists);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Wire up hover/click instrumentation once the iframe content is loaded.
  const instrument = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;

    // Inject our stylesheet.
    if (!doc.getElementById("rr-style")) {
      const style = doc.createElement("style");
      style.id = "rr-style";
      style.textContent = FRAME_CSS;
      doc.head?.appendChild(style);
    }

    let activeBtn: HTMLButtonElement | null = null;

    const removeBtn = () => {
      activeBtn?.remove();
      activeBtn = null;
    };

    const reviewable = doc.querySelectorAll(`[${idAttr}]`);
    reviewable.forEach((el) => {
      const node = el as HTMLElement;
      node.addEventListener("mouseenter", () => {
        node.classList.add("rr-hover");
        removeBtn();
        const btn = doc.createElement("button");
        btn.className = "rr-comment-btn";
        btn.textContent = "💬 コメント";
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          const rrId = node.getAttribute(idAttr)!;
          const targetType = classifyTarget(node);
          const selection = doc.getSelection()?.toString() ?? "";
          const target: InlineTarget = {
            rrId,
            tagName: node.tagName.toLowerCase(),
            targetType,
            selectedText: selection || (node.textContent ?? "").trim().slice(0, 200),
          };
          if (targetType === "table_cell" || targetType === "table_row") {
            const table = node.closest("table");
            target.tableRrId = table?.getAttribute(idAttr) ?? null;
          }
          pickRef.current(target);
        });
        node.appendChild(btn);
        activeBtn = btn;
      });
      node.addEventListener("mouseleave", () => {
        node.classList.remove("rr-hover");
      });
    });
  }, [idAttr]);

  // Reflect which elements have *pending* comments via markers. Applied/
  // archived comments are intentionally not highlighted — once a comment has
  // been reflected into the HTML, its location no longer needs a marker.
  const applyMarkers = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll(".rr-commented").forEach((el) =>
      el.classList.remove("rr-commented"),
    );
    const commentedIds = new Set(
      comments
        .filter((c) => c.rrId && c.status !== "applied" && c.status !== "archived")
        .map((c) => c.rrId as string),
    );
    commentedIds.forEach((id) => {
      const el = doc.querySelector(`[${idAttr}="${id}"]`);
      el?.classList.add("rr-commented");
    });
  }, [comments, idAttr]);

  useEffect(() => {
    applyMarkers();
  }, [applyMarkers, html]);

  // Scroll the iframe to the element bearing the given rr-id and flash it.
  const scrollToRrId = useCallback(
    (rrId: string) => {
      const doc = frameRef.current?.contentDocument;
      if (!doc) return false;
      const el = doc.querySelector(`[${idAttr}="${rrId}"]`) as HTMLElement | null;
      if (!el) return false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("rr-flash");
      window.setTimeout(() => el.classList.remove("rr-flash"), 1600);
      return true;
    },
    [idAttr],
  );

  return {
    frameRef,
    html,
    idAttr,
    exists,
    reload,
    instrument,
    applyMarkers,
    scrollToRrId,
  };
}
