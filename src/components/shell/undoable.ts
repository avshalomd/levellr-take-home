// A delete that waits for its Undo window: the item leaves the list at once, the request goes out only when the
// window closes without an Undo. Settling twice (a toast fires both its auto-close and its dismiss) sends once.
export function undoable(commit: () => void | Promise<void>): { undo: () => void; settle: () => void } {
  let done = false;
  return {
    undo: () => {
      done = true;
    },
    settle: () => {
      if (done) return;
      done = true;
      void commit();
    },
  };
}
