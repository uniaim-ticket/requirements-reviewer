import React from "react";

// Simple presentational wrapper for the right pane; App fills children.
export function Sidebar({ children }: { children: React.ReactNode }) {
  return <aside className="sidebar">{children}</aside>;
}
