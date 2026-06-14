import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import type { Comment, CreateCommentInput } from "../types.js";

export function useComments() {
  const [comments, setComments] = useState<Comment[]>([]);

  const refresh = useCallback(async () => {
    const { comments } = await api.listComments();
    setComments(comments);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: CreateCommentInput) => {
      const res = await api.createComment(input);
      await refresh();
      return res;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteComment(id);
      await refresh();
    },
    [refresh],
  );

  const enqueue = useCallback(
    async (ids: string[]) => {
      await api.enqueue(ids);
      await refresh();
    },
    [refresh],
  );

  return { comments, refresh, create, remove, enqueue };
}
