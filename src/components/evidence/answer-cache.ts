// A per-visit cache of fetches by id that keeps only answers. A load that resolves (including to "not found") is
// remembered; one that rejects (a network error, a 5xx) is forgotten, so the next ask tries again instead of repeating
// the failure for the rest of the visit. Unit-tested in answer-cache.test.ts.

export function answerCache<T>(load: (id: string) => Promise<T>): (id: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();
  return (id) => {
    let p = cache.get(id);
    if (!p) {
      p = load(id);
      cache.set(id, p);
      p.catch(() => {
        if (cache.get(id) === p) cache.delete(id);
      });
    }
    return p;
  };
}
