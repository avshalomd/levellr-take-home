// Retry for Jev and other model calls that fail transiently: a rate limit from a shared pool, a server error, a timeout.

const RETRY_DELAYS_MS = [400, 1_200, 3_000]; // one try, then three more on a rate limit, an outage or a timeout

/** A failure worth another try: a rate limit, a server error or a timeout. A refused key or an off-schema answer
 *  will fail the same way again. */
export function transient(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if ((e as { kind?: string }).kind === "timeout") return true;
  return /\bHTTP (429|5\d\d)\b|rate limit|too many requests|temporarily unavailable/i.test(e.message);
}

/** `fn`, tried again after each delay while it fails transiently. The last failure is thrown. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  delays: readonly number[] = RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delays.length || !transient(e)) throw e;
      // Jitter, so the reads that failed together do not all come back in the same instant.
      await sleep(delays[attempt] * (0.75 + Math.random() * 0.5));
    }
  }
}
