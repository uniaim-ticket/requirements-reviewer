import React from "react";

interface Props {
  diff: string | null;
}

// Render a unified diff with +/- line coloring.
export function DiffPanel({ diff }: Props) {
  if (!diff) return null;
  const lines = diff.split("\n");
  return (
    <section className="panel diff-panel">
      <h3>diff</h3>
      <pre className="diff">
        {lines.map((line, i) => {
          let cls = "diff-context";
          if (line.startsWith("+") && !line.startsWith("+++")) cls = "diff-add";
          else if (line.startsWith("-") && !line.startsWith("---"))
            cls = "diff-del";
          else if (line.startsWith("@@")) cls = "diff-hunk";
          return (
            <div key={i} className={cls}>
              {line || " "}
            </div>
          );
        })}
      </pre>
    </section>
  );
}
