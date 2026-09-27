// next/cache has no cache store outside a Next server (unstable_cache throws there), so a unit test that needs to see
// what is cached mocks it with this: `vi.mock("next/cache", () => import("@/test/next-cache-fake"))`. It keeps what
// Next keeps - a result per key parts and arguments, JSON round-tripped, never a throw - drops every entry carrying a
// tag on revalidateTag, and treats an entry older than its `revalidate` seconds as gone. `now` is the test's clock.
// (open item 2026-09-26: the Explore grid's version read is cached, and its test counts the queries.)

type Entry = { value: string; tags: string[]; at: number; ttl: number | false };

const store = new Map<string, Entry>();
let clock = 0;
export const revalidated: { tag: string; profile: unknown }[] = [];

export function resetNextCache() {
  store.clear();
  revalidated.length = 0;
  clock = 0;
}

/** Moves the fake clock on, in seconds. */
export function advance(seconds: number) {
  clock += seconds * 1000;
}

export function unstable_cache<A extends unknown[], T>(
  cb: (...args: A) => Promise<T>,
  keyParts: string[] = [],
  options: { tags?: string[]; revalidate?: number | false } = {},
): (...args: A) => Promise<T> {
  return async (...args: A) => {
    const key = JSON.stringify([keyParts, args]);
    const hit = store.get(key);
    const ttl = options.revalidate ?? false;
    if (hit && (hit.ttl === false || clock - hit.at < hit.ttl * 1000)) return JSON.parse(hit.value) as T;
    const value = await cb(...args);
    store.set(key, { value: JSON.stringify(value), tags: options.tags ?? [], at: clock, ttl });
    return value;
  };
}

export function revalidateTag(tag: string, profile: unknown) {
  revalidated.push({ tag, profile });
  for (const [k, e] of store) if (e.tags.includes(tag)) store.delete(k);
}
