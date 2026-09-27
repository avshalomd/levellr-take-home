import "server-only";
import { neon } from "@neondatabase/serverless";

// Raw parameterised SQL over Neon's HTTP driver: one round trip per query, nothing to pool in a serverless function.
// The schema is db/schema.sql, built by the Python pipeline; the app only reads it.
const client = neon(process.env.DATABASE_URL ?? "postgresql://missing:missing@localhost/missing");

// Rows leave here as plain JSON: they go to the model as tool results and to the browser, and neither takes a Date.
// The driver returns timestamptz as Date, so those become ISO strings; every other column is already JSON.
const plain = (row: Record<string, unknown>) => {
  for (const k in row) if (row[k] instanceof Date) row[k] = (row[k] as Date).toISOString();
  return row;
};

export async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  return ((await client.query(text, params)) as Record<string, unknown>[]).map(plain) as T[];
}

/** Several statements as one Postgres transaction (one HTTP round trip): all of them apply, or none. */
export async function transaction(statements: [text: string, params?: unknown[]][]): Promise<void> {
  await client.transaction(statements.map(([text, params = []]) => client.query(text, params)));
}
