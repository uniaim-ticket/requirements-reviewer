import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import type { DocumentInfo } from "../types.js";

export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await api.listDocuments();
    setDocuments(res.documents);
    setCurrentId(res.currentId);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const select = useCallback(
    async (id: string) => {
      await api.selectDocument(id);
      await refresh();
    },
    [refresh],
  );

  const generate = useCallback(
    async (input: { title?: string; prompt?: string; asNew?: boolean }) => {
      await api.generate(input);
      // The document list / current id update arrive via SSE; refresh anyway.
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string, removeFile = false) => {
      await api.deleteDocument(id, removeFile);
      await refresh();
    },
    [refresh],
  );

  return { documents, currentId, refresh, select, generate, remove, setCurrentId };
}
