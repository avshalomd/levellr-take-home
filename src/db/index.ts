import "server-only";
import { neon, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;

// HTTP driver: one round trip per query, no interactive transactions. Lazy so `next build` works without a database.
export const db = drizzle(neon(url ?? "postgresql://missing:missing@localhost/missing"), { schema });
export const dbConfigured = Boolean(url);
export { schema };

const txDb = (pool: Pool) => drizzleWs(pool, { schema });
export type Tx = Parameters<Parameters<ReturnType<typeof txDb>["transaction"]>[0]>[0];

/**
 * A real BEGIN/COMMIT transaction for multi-row writes that must be atomic (the HTTP driver cannot do them).
 * Opens a WebSocket pool for the call and closes it after, which is safe in serverless functions.
 *   await transaction(async (tx) => { const [po] = await tx.insert(orders).values(o).returning(); await tx.insert(lines).values(...); });
 */
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: url });
  try {
    return await txDb(pool).transaction(fn);
  } finally {
    await pool.end();
  }
}
